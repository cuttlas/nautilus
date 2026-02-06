import type { Bot } from 'grammy';
import type { NautilusBotContext } from '../types.js';

function contextTag(ctx: NautilusBotContext): string {
  const chatId = ctx.chat?.id ?? 'unknown';
  const userId = ctx.from?.id ?? 'unknown';
  return `chat=${chatId} user=${userId}`;
}

export function registerHelpCommand(bot: Bot<NautilusBotContext>): void {
  bot.command('help', async (ctx) => {
    console.log(`[help] /help received ${contextTag(ctx)}`);
    await ctx.reply(
      [
        'Available commands:',
        '/new <topic> - start a new research project',
        '/add <topic> - add a research topic to the backlog',
        '/status - show project status',
        '/site - show the project site URL',
        '/pause - pause the research heartbeat',
        '/resume - resume the research heartbeat',
        '/backlog - show pending tasks',
        '/blindspot - suggest research gaps',
        '/help - show this message',
      ].join('\n'),
    );
  });
}
