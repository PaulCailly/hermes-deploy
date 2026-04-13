import { Command } from 'commander';
import { upCommand } from './commands/up.js';
import { updateCommand } from './commands/update.js';
import { destroyCommand } from './commands/destroy.js';
import { statusCommand } from './commands/status.js';
import { sshCommand } from './commands/ssh.js';
import { lsCommand } from './commands/ls.js';
import { logsCommand } from './commands/logs.js';
import { initCommand } from './commands/init.js';
import { adoptCommand } from './commands/adopt.js';
import { dashboardCommand } from './commands/dashboard.js';
import {
  secretSet,
  secretGet,
  secretRemove,
  secretList,
  secretEdit,
} from './commands/secret.js';
import { keyExport, keyImport, keyPath } from './commands/key.js';

// HERMES_DEPLOY_VERSION is replaced at build time by tsup's `define`
// with the version from package.json, so `hermes-deploy --version`
// always matches the published package.
declare const HERMES_DEPLOY_VERSION: string;

const program = new Command();

program
  .name('hermes-deploy')
  .description('Deploy hermes-agent to AWS or GCP')
  .version(HERMES_DEPLOY_VERSION);

program
  .command('init')
  .option('--name <name>', 'deployment name (defaults to sanitized directory name)')
  .description('Scaffold a new hermes-deploy project in the current directory')
  .action(async (opts) => {
    try {
      await initCommand({ name: opts.name });
    } catch (e) {
      console.error(`hermes-deploy init: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('up')
  .argument('[name]', 'deployment name (defaults to the name in ./hermes.toml)')
  .option('--name <name>', 'deployment name (use instead of cwd lookup)')
  .option('--project <path>', 'project directory (use instead of cwd lookup)')
  .description('Provision and configure the deployment defined by hermes.toml')
  .action(async (positionalName, opts) => {
    try {
      await upCommand({ name: opts.name ?? positionalName, projectPath: opts.project });
    } catch (e) {
      console.error(`hermes-deploy up: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('update')
  .argument('[name]', 'deployment name (defaults to the name in ./hermes.toml)')
  .option('--name <name>', 'deployment name (use instead of cwd lookup)')
  .option('--project <path>', 'project directory (use instead of cwd lookup)')
  .description('Push config changes to an existing deployment (skips provisioning)')
  .action(async (positionalName, opts) => {
    try {
      await updateCommand({ name: opts.name ?? positionalName, projectPath: opts.project });
    } catch (e) {
      console.error(`hermes-deploy update: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('destroy')
  .argument('[name]', 'deployment name (defaults to the name in ./hermes.toml)')
  .option('--name <name>', 'deployment name (use instead of cwd lookup)')
  .option('--project <path>', 'project directory (use instead of cwd lookup)')
  .option('--yes', 'skip confirmation prompt')
  .action(async (positionalName, opts) => {
    try {
      await destroyCommand({
        name: opts.name ?? positionalName,
        projectPath: opts.project,
        yes: opts.yes,
      });
    } catch (e) {
      console.error(`hermes-deploy destroy: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('status')
  .argument('[name]', 'deployment name (defaults to ./hermes.toml)')
  .option('--name <name>', 'deployment name (use instead of cwd lookup)')
  .option('--project <path>', 'project directory (use instead of cwd lookup)')
  .option('--json', 'output as JSON instead of human-formatted text')
  .action(async (positionalName, opts) => {
    try {
      await statusCommand({
        name: opts.name ?? positionalName,
        projectPath: opts.project,
        json: opts.json,
      });
    } catch (e) {
      console.error(`hermes-deploy status: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('ssh')
  .argument('[name]', 'deployment name (defaults to ./hermes.toml)')
  .option('--name <name>', 'deployment name (use instead of cwd lookup)')
  .option('--project <path>', 'project directory (use instead of cwd lookup)')
  .action(async (positionalName, opts) => {
    try {
      await sshCommand({ name: opts.name ?? positionalName, projectPath: opts.project });
    } catch (e) {
      console.error(`hermes-deploy ssh: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('logs')
  .argument('[name]', 'deployment name (defaults to ./hermes.toml)')
  .option('--name <name>', 'deployment name (use instead of cwd lookup)')
  .option('--project <path>', 'project directory (use instead of cwd lookup)')
  .description('Stream the remote hermes-agent service log until Ctrl-C')
  .action(async (positionalName, opts) => {
    try {
      await logsCommand({ name: opts.name ?? positionalName, projectPath: opts.project });
    } catch (e) {
      console.error(`hermes-deploy logs: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('ls')
  .description('List all deployments across all clouds')
  .option('--watch', 'poll live status continuously (Ink dashboard, post-Phase H)')
  .option('--json', 'output as JSON instead of a table')
  .action(async (opts) => {
    try {
      await lsCommand({ watch: opts.watch, json: opts.json });
    } catch (e) {
      console.error(`hermes-deploy ls: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('adopt')
  .description(
    'Rebuild the local state entry for a deployment by discovering its cloud resources via tags',
  )
  .requiredOption('--name <name>', 'deployment name (required)')
  .option('--project <path>', 'project directory (defaults to cwd walk)')
  .option('--force', 'replace an existing state entry')
  .option('--dry-run', 'preview the rebuilt ledger without writing state')
  .option('--json', 'output the rebuilt record as JSON')
  .action(async (opts) => {
    try {
      await adoptCommand({
        name: opts.name,
        projectPath: opts.project,
        force: opts.force,
        dryRun: opts.dryRun,
        json: opts.json,
      });
    } catch (e) {
      console.error(`hermes-deploy adopt: ${(e as Error).message}`);
      process.exit(1);
    }
  });

const secret = program.command('secret').description('Manage sops-encrypted secrets');

secret
  .command('set <key> <value>')
  .option('--name <name>', 'deployment name')
  .option('--project <path>', 'project directory')
  .action(async (key, value, opts) => {
    try {
      await secretSet({ key, value, name: opts.name, projectPath: opts.project });
    } catch (e) {
      console.error(`hermes-deploy secret set: ${(e as Error).message}`);
      process.exit(1);
    }
  });

secret
  .command('get <key>')
  .option('--name <name>', 'deployment name')
  .option('--project <path>', 'project directory')
  .action(async (key, opts) => {
    try {
      const v = await secretGet({ key, name: opts.name, projectPath: opts.project });
      if (v === undefined) {
        console.error(`no such secret: ${key}`);
        process.exit(1);
      }
      console.log(v);
    } catch (e) {
      console.error(`hermes-deploy secret get: ${(e as Error).message}`);
      process.exit(1);
    }
  });

secret
  .command('rm <key>')
  .option('--name <name>', 'deployment name')
  .option('--project <path>', 'project directory')
  .action(async (key, opts) => {
    try {
      await secretRemove({ key, name: opts.name, projectPath: opts.project });
    } catch (e) {
      console.error(`hermes-deploy secret rm: ${(e as Error).message}`);
      process.exit(1);
    }
  });

secret
  .command('list')
  .option('--name <name>', 'deployment name')
  .option('--project <path>', 'project directory')
  .option('--json', 'output the key list as a JSON array')
  .action(async (opts) => {
    try {
      const keys = await secretList({ name: opts.name, projectPath: opts.project });
      if (opts.json) {
        process.stdout.write(JSON.stringify(keys, null, 2) + '\n');
      } else {
        for (const k of keys) console.log(k);
      }
    } catch (e) {
      console.error(`hermes-deploy secret list: ${(e as Error).message}`);
      process.exit(1);
    }
  });

secret
  .command('edit')
  .option('--name <name>', 'deployment name')
  .option('--project <path>', 'project directory')
  .action(async (opts) => {
    try {
      await secretEdit({ name: opts.name, projectPath: opts.project });
    } catch (e) {
      console.error(`hermes-deploy secret edit: ${(e as Error).message}`);
      process.exit(1);
    }
  });

const key = program.command('key').description('Manage per-deployment age keys');

key
  .command('export <name>')
  .description("Write a deployment's age private key to stdout")
  .action(async (name) => {
    try {
      process.stdout.write(await keyExport({ name }));
    } catch (e) {
      console.error(`hermes-deploy key export: ${(e as Error).message}`);
      process.exit(1);
    }
  });

key
  .command('import <name> <path>')
  .description('Copy an age private key into the hermes-deploy config')
  .action(async (name, path) => {
    try {
      console.log(await keyImport({ name, path }));
    } catch (e) {
      console.error(`hermes-deploy key import: ${(e as Error).message}`);
      process.exit(1);
    }
  });

key
  .command('path <name>')
  .description("Print the on-disk path of a deployment's age key")
  .option('--json', 'output as JSON ({"name": ..., "path": ...}) instead of bare path')
  .action(async (name, opts) => {
    try {
      const path = await keyPath({ name });
      if (opts.json) {
        process.stdout.write(JSON.stringify({ name, path }, null, 2) + '\n');
      } else {
        console.log(path);
      }
    } catch (e) {
      console.error(`hermes-deploy key path: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('dashboard')
  .description('Start the local web dashboard')
  .option('--host <host>', 'bind address', '127.0.0.1')
  .option('--port <port>', 'TCP port (0 = random available)', (v: string) => {
    const n = Number.parseInt(v, 10);
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      throw new Error(`invalid port "${v}" — must be an integer between 0 and 65535`);
    }
    return n;
  }, 0)
  .option('--no-open', 'do not open a browser window')
  .option('--no-auth', 'disable token auth (dangerous)')
  .action(async (opts) => {
    try {
      await dashboardCommand({
        host: opts.host,
        port: opts.port,
        open: opts.open,
        auth: opts.auth,
      });
    } catch (e) {
      console.error(`hermes-deploy dashboard: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
