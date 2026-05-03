import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createDashboardServer } from '../server/index.js';
import { openBrowser } from '../server/open-browser.js';
import { checkCliUpdate } from '../updates/cli-update-check.js';
import { getStatePaths } from '../state/paths.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const HERMES_DEPLOY_VERSION: string;

export interface DashboardOptions {
  host?: string;
  port?: number;
  open?: boolean;
  auth?: boolean;
}

function ensureWebBuilt(): void {
  const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
  if (existsSync(join(distDir, 'index.html'))) return;

  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const webDir = join(projectRoot, 'web');
  if (!existsSync(join(webDir, 'package.json'))) return; // installed via npm, no source

  console.log('Web dashboard not built — building now...');
  try {
    execSync('npm run build:web && npm run build:copy-web', {
      cwd: projectRoot,
      stdio: 'inherit',
    });
  } catch {
    console.error('Failed to auto-build dashboard. Run manually: npm run build');
  }
}

export async function dashboardCommand(opts: DashboardOptions): Promise<void> {
  ensureWebBuilt();
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 0;
  const auth = opts.auth !== false;

  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    if (!auth) {
      console.error(
        '\x1b[31m⚠ WARNING: Running without auth on a non-loopback address is dangerous.\x1b[0m',
      );
      console.error('Anyone on the network can control your deployments.');
      console.error('Starting in 3 seconds... Press Ctrl-C to abort.\n');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  const server = await createDashboardServer({ host, port, auth });
  const { url, token } = await server.start();
  const publicUrl = token ? `${url}/#token=${token}` : url;

  console.log(`\nhermes-deploy dashboard running at:\n`);
  console.log(`  ${publicUrl}\n`);

  try {
    const paths = getStatePaths();
    const cacheFile = join(paths.configDir, 'npm-update-check.json');
    const check = await checkCliUpdate(HERMES_DEPLOY_VERSION, cacheFile);
    if (check.updateAvailable) {
      console.log(
        `  Update available: hermes-deploy v${check.latest} — npm install -g @paulcailly/hermes-deploy@latest\n`,
      );
    }
  } catch {
    // Non-fatal
  }

  if (opts.open !== false && process.stdout.isTTY) {
    openBrowser(publicUrl);
  }

  // Keep alive until Ctrl-C
  await new Promise<void>(resolve => {
    const handler = () => {
      console.log('\nshutting down dashboard...');
      resolve();
    };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  });

  await server.stop();
}
