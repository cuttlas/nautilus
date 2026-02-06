import type { Bot } from 'grammy';
import { readProject } from '../../project/project.js';
import type { BotDependencies, NautilusBotContext } from '../types.js';

function contextTag(ctx: NautilusBotContext): string {
  const chatId = ctx.chat?.id ?? 'unknown';
  const userId = ctx.from?.id ?? 'unknown';
  return `chat=${chatId} user=${userId}`;
}

export function registerSiteCommand(bot: Bot<NautilusBotContext>, deps: BotDependencies): void {
  bot.command('site', async (ctx) => {
    console.log(`[site] /site received ${contextTag(ctx)}`);
    const project = await readProject(deps.repo);

    if (!project) {
      await ctx.reply('No project found yet. Start one with /new <topic>.');
      return;
    }

    await ctx.reply(
      [
        `Project: ${project.title}`,
        `Status: ${project.status}`,
        `Site: ${project.siteUrl}`,
      ].join('\n'),
    );
  });
}
