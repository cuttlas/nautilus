import 'dotenv/config';
import { loadConfig } from './config.js';
import { getDataRepo } from './git/sync.js';

async function main() {
  console.log('Nautilus starting...');

  const config = loadConfig();
  console.log(`Project: ${config.dataRepoUrl}`);

  const repo = await getDataRepo(config);
  console.log(`Data repo ready at: ${repo.getLocalPath()}`);

  // TODO: Initialize bot, start heartbeat
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
