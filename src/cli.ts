import { Command } from 'commander';
import { upCommand } from './commands/up.js';
import { updateCommand } from './commands/update.js';
import { destroyCommand } from './commands/destroy.js';
import { statusCommand } from './commands/status.js';
import { sshCommand } from './commands/ssh.js';
import { lsCommand } from './commands/ls.js';
import { logsCommand } from './commands/logs.js';
import { initCommand } from './commands/init.js';
import {
  secretSet,
  secretGet,
  secretRemove,
  secretList,
  secretEdit,
} from './commands/secret.js';
import { keyExport, keyImport, keyPath } from './commands/key.js';

const program = new Command();

program
  .name('hermes-deploy')
  .description('Deploy hermes-agent to AWS or GCP')
  .version('0.2.0-m2');

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
  .action(async (positionalName, opts) => {
    try {
      await statusCommand({ name: opts.name ?? positionalName, projectPath: opts.project });
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
  .action(async (opts) => {
    try {
      await lsCommand({ watch: opts.watch });
    } catch (e) {
      console.error(`hermes-deploy ls: ${(e as Error).message}`);
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
  .action(async (opts) => {
    try {
      const keys = await secretList({ name: opts.name, projectPath: opts.project });
      for (const k of keys) console.log(k);
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
  .action(async (name) => {
    try {
      console.log(await keyPath({ name }));
    } catch (e) {
      console.error(`hermes-deploy key path: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
