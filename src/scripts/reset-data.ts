import 'dotenv/config';
import { readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { NautilusConfig } from '../config.js';
import { getDataRepo } from '../git/sync.js';

interface CliOptions {
  yes: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const args = new Set(argv);
  return {
    yes: args.has('--yes') || args.has('-y'),
    dryRun: args.has('--dry-run'),
  };
}

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  npm run data:reset -- --yes',
      '  npm run data:reset -- --dry-run',
      '',
      'Flags:',
      '  --yes      Execute destructive reset.',
      '  --dry-run  Print what would be deleted without changing files.',
    ].join('\n'),
  );
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildResetConfig(dataRepoUrl: string, githubToken: string): NautilusConfig {
  return {
    telegramBotToken: 'unused-for-data-reset',
    telegramChatId: 'unused-for-data-reset',
    anthropicApiKey: undefined,
    googleGenerativeAiApiKey: undefined,
    tavilyApiKey: 'unused-for-data-reset',
    githubToken,
    dataRepoUrl,
    defaultModel: 'gemini-2.5-flash',
    heartbeatIntervalMinutes: 30,
    maxStepsPerTask: 25,
    siteUrl: 'https://example.pages.dev',
    blindspotIntervalMinutes: 120,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.yes && !options.dryRun) {
    console.error('Refusing to reset without --yes (or use --dry-run first).');
    printUsage();
    process.exitCode = 1;
    return;
  }

  const dataRepoUrl = readRequiredEnv('DATA_REPO_URL');
  const slug = dataRepoUrl.split('/').pop();
  if (!slug) {
    throw new Error(`Invalid DATA_REPO_URL: ${dataRepoUrl}`);
  }

  const localPath = join(homedir(), '.nautilus', 'data', slug);

  if (options.dryRun && !existsSync(localPath)) {
    console.log(`Data repo: ${dataRepoUrl}`);
    console.log(`Local path: ${localPath}`);
    console.log('Local clone does not exist yet. Nothing to delete.');
    return;
  }

  let repo: Awaited<ReturnType<typeof getDataRepo>> | null = null;
  if (options.yes) {
    const githubToken = readRequiredEnv('GITHUB_TOKEN');
    repo = await getDataRepo(buildResetConfig(dataRepoUrl, githubToken));
  }

  const entries = await readdir(localPath, { withFileTypes: true });
  const targets = entries
    .map((entry) => entry.name)
    .filter((name) => name !== '.git')
    .sort((a, b) => a.localeCompare(b));

  console.log(`Data repo: ${dataRepoUrl}`);
  console.log(`Local path: ${localPath}`);

  if (targets.length === 0) {
    console.log('Data repo is already empty (except .git).');
    return;
  }

  console.log('Targets:');
  for (const target of targets) {
    console.log(`- ${target}`);
  }

  if (options.dryRun) {
    console.log('Dry run complete. No files were deleted.');
    return;
  }

  for (const target of targets) {
    await rm(join(localPath, target), { recursive: true, force: true });
  }

  if (!repo) {
    throw new Error('Internal error: reset repo client is not initialized.');
  }

  await repo.commitAndPush('Reset data repo: remove all project files');
  console.log('Reset complete and pushed.');
}

main().catch((error) => {
  console.error('Reset failed:', error);
  process.exit(1);
});
