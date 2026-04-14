import { readFileSync } from 'node:fs';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import { createSshSession, type SshSession } from '../remote-ops/session.js';

interface CachedSession {
  session: SshSession;
  expiresAt: number;
  createdAt: number;
  /** Lazily resolved on first sqlite query — null if detection fails. */
  pythonPath: string | null | undefined;
}

/**
 * Hermes on deployed NixOS boxes runs as the `hermes` user with HOME
 * `/var/lib/hermes`, so its state lives under `/var/lib/hermes/.hermes/`.
 * When we SSH as root, `~/.hermes/` resolves to `/root/.hermes/` which
 * does not exist — always use this absolute path instead.
 */
export const HERMES_HOME = '/var/lib/hermes/.hermes';

const SESSION_TTL_MS = 30_000;
const sessionCache = new Map<string, CachedSession>();

export class AgentNotFoundError extends Error {
  constructor(name: string) {
    super(`Agent "${name}" not found`);
    this.name = 'AgentNotFoundError';
  }
}

async function resolveAgent(name: string): Promise<{ host: string; privateKey: string }> {
  const store = new StateStore(getStatePaths());
  const state = await store.read();
  const dep = state.deployments[name];
  if (!dep) throw new AgentNotFoundError(name);
  if (!dep.instance_ip) throw new Error(`Agent "${name}" has no instance_ip`);
  const privateKey = readFileSync(dep.ssh_key_path, 'utf-8');
  return { host: dep.instance_ip, privateKey };
}

/** Get or create a cached SSH session for an agent. Sessions expire after 30s. */
export async function getAgentSshSession(name: string): Promise<SshSession> {
  const entry = await getOrCreateCacheEntry(name);
  return entry.session;
}

async function getOrCreateCacheEntry(name: string): Promise<CachedSession> {
  const now = Date.now();
  const cached = sessionCache.get(name);
  if (cached && cached.expiresAt > now) {
    return cached;
  }
  if (cached) {
    cached.session.dispose().catch(() => {});
    sessionCache.delete(name);
  }

  const { host, privateKey } = await resolveAgent(name);
  const session = await createSshSession({
    host,
    username: 'root',
    privateKey,
    readyTimeoutMs: 10_000,
  });
  const entry: CachedSession = {
    session,
    expiresAt: now + SESSION_TTL_MS,
    createdAt: now,
    pythonPath: undefined,
  };
  sessionCache.set(name, entry);
  return entry;
}

/** Dispose the cached session for an agent (e.g. when agent is destroyed). */
export async function disposeAgentSshSession(name: string): Promise<void> {
  const cached = sessionCache.get(name);
  if (!cached) return;
  sessionCache.delete(name);
  await cached.session.dispose().catch(() => {});
}

/** Shell-escape a single argument (single quotes). */
function shEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Resolve a working python3 path on the agent. Tries (in order):
 *   1. command -v python3 (if on PATH)
 *   2. find an executable python3 inside a hermes-agent-env nix store path (NixOS deployment)
 * Returns the path or null if none found. Cached per SSH session.
 */
async function resolvePython3(name: string): Promise<string | null> {
  const entry = await getOrCreateCacheEntry(name);
  if (entry.pythonPath !== undefined) return entry.pythonPath;

  // Note: python3 under the nix-store hermes-agent-env is a symlink, so we
  // must NOT restrict find to -type f. We accept any executable entry.
  const res = await entry.session.exec(
    `command -v python3 2>/dev/null || ` +
    `find /nix/store -maxdepth 4 -path '*hermes-agent-env*/bin/python3' 2>/dev/null | head -1 || ` +
    `find /nix/store -maxdepth 4 -name python3 2>/dev/null | head -1`,
  );
  const path = res.stdout.trim();
  entry.pythonPath = path || null;
  return entry.pythonPath;
}

/**
 * Python script executed on the agent. It reads base64-encoded SQL from a
 * command-line argument, runs it against the Hermes state.db, and prints
 * a JSON array to stdout. Timestamps stored as REAL Unix seconds are
 * converted to ISO 8601 strings (any column ending in `_at` or named
 * `timestamp`). Integer ids are stringified for consistent frontend types.
 */
const QUERY_SCRIPT = String.raw`import sqlite3,sys,json,datetime,base64
try:
    sql = base64.b64decode(sys.argv[1]).decode('utf-8')
    con = sqlite3.connect('${HERMES_HOME}/state.db')
    con.row_factory = sqlite3.Row
    cur = con.execute(sql)
    out = []
    for row in cur:
        d = dict(row)
        for k, v in list(d.items()):
            if isinstance(v, (int, float)) and (k.endswith('_at') or k == 'timestamp'):
                try:
                    d[k] = datetime.datetime.fromtimestamp(v, datetime.timezone.utc).isoformat().replace('+00:00','Z')
                except Exception:
                    pass
            elif isinstance(v, int) and k == 'id':
                d[k] = str(v)
        out.append(d)
    print(json.dumps(out, default=str))
except Exception:
    print('[]')
`;

/**
 * Run a SQL query on the agent's state.db and parse the result as JSON.
 * Uses python3 (sqlite3 CLI is not available on NixOS). Returns an empty
 * array on any failure (missing python, missing DB, missing table, bad SQL).
 */
export async function runSqliteJson<T>(name: string, sql: string): Promise<T[]> {
  try {
    const pyPath = await resolvePython3(name);
    if (!pyPath) return [];
    const entry = await getOrCreateCacheEntry(name);
    const sqlB64 = Buffer.from(sql, 'utf-8').toString('base64');
    const cmd = `${shEscape(pyPath)} -c ${shEscape(QUERY_SCRIPT)} ${shEscape(sqlB64)} 2>/dev/null || echo '[]'`;
    const res = await entry.session.exec(cmd);
    const out = res.stdout.trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** Read a remote file. Returns contents or null if the file does not exist. */
export async function readRemoteFile(name: string, path: string): Promise<string | null> {
  try {
    const session = await getAgentSshSession(name);
    const res = await session.exec(`test -f ${shEscape(path)} && cat ${shEscape(path)} || true`);
    return res.stdout || null;
  } catch {
    return null;
  }
}

/** Read + parse a remote JSON file. Returns parsed object or null. */
export async function readRemoteJson<T>(name: string, path: string): Promise<T | null> {
  const body = await readRemoteFile(name, path);
  if (!body) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

/** List entries in a remote directory (non-recursive, names only). */
export async function listRemoteDir(name: string, path: string): Promise<string[]> {
  try {
    const session = await getAgentSshSession(name);
    const res = await session.exec(`ls -1 ${shEscape(path)} 2>/dev/null || true`);
    return res.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Write a file to the remote agent via SFTP. Expands `~/` to $HOME via SSH
 * before writing because SFTP doesn't expand tilde.
 */
export async function writeRemoteFile(name: string, path: string, contents: string): Promise<void> {
  const session = await getAgentSshSession(name);
  let resolvedPath = path;
  if (path.startsWith('~/')) {
    const res = await session.exec(`echo $HOME`);
    const home = res.stdout.trim();
    if (home) resolvedPath = `${home}/${path.slice(2)}`;
  }
  await session.uploadFile(resolvedPath, contents);
}

/** Run an arbitrary command on the agent. Returns exec result. */
export async function runRemoteCommand(name: string, cmd: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const session = await getAgentSshSession(name);
  return session.exec(cmd);
}
