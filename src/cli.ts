import { Command } from 'commander';
import { upCommand } from './commands/up.js';
import { updateCommand } from './commands/update.js';
import { destroyCommand } from './commands/destroy.js';
import { statusCommand } from './commands/status.js';
import { sshCommand } from './commands/ssh.js';
import { lsCommand } from './commands/ls.js';
import { logsCommand } from './commands/logs.js';
import { initCommand } from './commands/init.js';

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

program.parseAsync(process.argv);
