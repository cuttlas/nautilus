import type { Bot } from 'grammy';
import type { NautilusConfig } from '../config.js';
import type { DataRepo } from '../git/sync.js';
import { readProject } from '../project/project.js';
import { analyzeBlindspots } from './analyzer.js';
import type { BlindspotSuggestion } from './analyzer.js';

interface BlindspotHeartbeatDependencies {
  config: NautilusConfig;
  repo: DataRepo;
  bot: Bot<any>;
}

export interface BlindspotHeartbeatController {
  stop: () => void;
  runNow: () => Promise<void>;
}

function formatMessage(suggestions: BlindspotSuggestion[]): string {
  const lines = [`Blindspot suggestions (${suggestions.length}):`];

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];
    lines.push('');
    lines.push(`${i + 1}. ${s.title}`);
    lines.push(`   ${s.rationale}`);
  }

  lines.push('');
  lines.push('Use /add <topic> to research any of these.');
  return lines.join('\n');
}

async function runBlindspotCycle(input: BlindspotHeartbeatDependencies): Promise<void> {
  const project = await readProject(input.repo);
  if (!project) {
    console.log('[blindspot] skipping: project.json not found');
    return;
  }

  if (project.status !== 'active') {
    console.log(`[blindspot] skipping: project status is ${project.status}`);
    return;
  }

  console.log('[blindspot] starting blindspot analysis');

  const suggestions = await analyzeBlindspots({
    config: input.config,
    repo: input.repo,
  });

  if (suggestions.length === 0) {
    console.log('[blindspot] no suggestions found');
    return;
  }

  console.log(`[blindspot] sending ${suggestions.length} suggestion(s) to Telegram`);
  await input.bot.api.sendMessage(
    input.config.telegramChatId,
    formatMessage(suggestions),
  );
}

export function startBlindspotHeartbeat(
  input: BlindspotHeartbeatDependencies,
): BlindspotHeartbeatController {
  const intervalMs = input.config.blindspotIntervalMinutes * 60_000;
  let running = false;
  let stopped = false;

  const runNow = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      await runBlindspotCycle(input);
    } catch (error) {
      console.error('[blindspot] unhandled cycle error:', error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void runNow();
  }, intervalMs);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    console.log('[blindspot] stopped');
  };

  return { stop, runNow };
}
