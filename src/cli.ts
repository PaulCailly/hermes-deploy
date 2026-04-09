import { Command } from 'commander';
import { upCommand } from './commands/up.js';

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

// destroy/status/ssh stubs land in J2-J4

program.parseAsync(process.argv);
