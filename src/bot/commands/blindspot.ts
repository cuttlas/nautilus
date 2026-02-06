import type { Bot } from 'grammy';
import { analyzeBlindspots } from '../../blindspot/analyzer.js';
import { readProject } from '../../project/project.js';
import type { BlindspotSuggestion } from '../../blindspot/analyzer.js';
import type { BotDependencies, NautilusBotContext } from '../types.js';

function contextTag(ctx: NautilusBotContext): string {
  const chatId = ctx.chat?.id ?? 'unknown';
  const userId = ctx.from?.id ?? 'unknown';
  return `chat=${chatId} user=${userId}`;
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

export function registerBlindspotCommand(bot: Bot<NautilusBotContext>, deps: BotDependencies): void {
  bot.command('blindspot', async (ctx) => {
    console.log(`[blindspot] /blindspot received ${contextTag(ctx)}`);
    const project = await readProject(deps.repo);

    if (!project) {
      await ctx.reply('No project found yet. Start one with /new <topic>.');
      return;
    }

    if (project.status !== 'active' && project.status !== 'paused') {
      await ctx.reply(`Can't analyze blindspots: project is ${project.status}.`);
      return;
    }

    await ctx.reply('Analyzing research coverage...');

    try {
      const suggestions = await analyzeBlindspots({
        config: deps.config,
        repo: deps.repo,
      });

      if (suggestions.length === 0) {
        await ctx.reply('No blindspots found. Coverage looks good!');
        return;
      }

      await ctx.reply(formatMessage(suggestions));
    } catch (error) {
      console.error('[blindspot] /blindspot command failed:', error);
      await ctx.reply('Blindspot analysis failed. Check the logs for details.');
    }
  });
}
