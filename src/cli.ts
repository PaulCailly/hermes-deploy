import { Command } from 'commander';
import { upCommand } from './commands/up.js';
import { destroyCommand } from './commands/destroy.js';

const program = new Command();

program
  .name('hermes-deploy')
  .description('Deploy hermes-agent to AWS or GCP')
  .version('0.1.0-m1');

program
  .command('up')
  .description('Provision and configure the deployment defined by ./hermes.toml')
  .action(async () => {
    try {
      await upCommand({});
    } catch (e) {
      console.error(`hermes-deploy up: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('destroy')
  .argument('[name]', 'deployment name (defaults to the name in ./hermes.toml)')
  .option('--yes', 'skip confirmation prompt')
  .action(async (name, opts) => {
    try {
      await destroyCommand({ name, yes: opts.yes });
    } catch (e) {
      console.error(`hermes-deploy destroy: ${(e as Error).message}`);
      process.exit(1);
    }
  });

// status/ssh stubs land in J3-J4

program.parseAsync(process.argv);
