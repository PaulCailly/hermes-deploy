import { createDashboardServer } from '../server/index.js';
import { openBrowser } from '../server/open-browser.js';

export interface DashboardOptions {
  host?: string;
  port?: number;
  open?: boolean;
  auth?: boolean;
}

export async function dashboardCommand(opts: DashboardOptions): Promise<void> {
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
