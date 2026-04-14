import { readFileSync } from 'node:fs';
import { StateStore } from '../state/store.js';
import { getStatePaths } from '../state/paths.js';
import { createSshSession, type SshSession } from '../remote-ops/session.js';

interface CachedSession {
  session: SshSession;
  expiresAt: number;
  createdAt: number;
}

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
  const now = Date.now();
  const cached = sessionCache.get(name);
  if (cached && cached.expiresAt > now) {
    return cached.session;
  }
  if (cached) {
    // Expired — dispose old one
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
  sessionCache.set(name, { session, expiresAt: now + SESSION_TTL_MS, createdAt: now });
  return session;
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
 * Run a sqlite3 query on the agent's ~/.hermes/state.db and parse the result
 * as JSON. Returns an empty array if the DB is missing, sqlite3 is not
 * installed, or the query errors (e.g. missing table/column).
 */
export async function runSqliteJson<T>(name: string, sql: string): Promise<T[]> {
  try {
    const session = await getAgentSshSession(name);
    // Redirect stderr to /dev/null so missing tables don't pollute stdout.
    // Fallback to [] if sqlite3 is missing or DB doesn't exist.
    const cmd = `sqlite3 -json "$HOME/.hermes/state.db" ${shEscape(sql)} 2>/dev/null || echo '[]'`;
    const res = await session.exec(cmd);
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
