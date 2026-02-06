import 'dotenv/config';
import { createBot } from './bot/bot.js';
import { loadConfig } from './config.js';
import { getDataRepo } from './git/sync.js';

async function main() {
  console.log('Nautilus starting...');

  const config = loadConfig();
  console.log(`Project: ${config.dataRepoUrl}`);

  const repo = await getDataRepo(config);
  console.log(`Data repo ready at: ${repo.getLocalPath()}`);

  const bot = createBot({ config, repo });
  let stopping = false;
  const stopBot = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.log(`Received ${signal}, stopping bot...`);
    bot.stop();
  };

  const onSigint = () => stopBot('SIGINT');
  const onSigterm = () => stopBot('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  try {
    await bot.start({
      onStart: (botInfo) => {
        console.log(`Bot started as @${botInfo.username}`);
      },
    });
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
