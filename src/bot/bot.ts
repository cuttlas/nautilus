import { conversations, createConversation } from '@grammyjs/conversations';
import { Bot } from 'grammy';
import { createScopingConversation, registerNewCommand, SCOPING_CONVERSATION } from './commands/new.js';
import { registerSiteCommand } from './commands/site.js';
import type { BotDependencies, NautilusBotContext } from './types.js';

function contextTag(ctx: NautilusBotContext): string {
  const chatId = ctx.chat?.id ?? 'unknown';
  const userId = ctx.from?.id ?? 'unknown';
  return `chat=${chatId} user=${userId}`;
}

function formatIncomingText(ctx: NautilusBotContext): string | null {
  const text = ctx.message?.text ?? ctx.channelPost?.text;
  if (!text) return null;

  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117)}...`;
}

export function createBot(deps: BotDependencies): Bot<NautilusBotContext> {
  const bot = new Bot<NautilusBotContext>(deps.config.telegramBotToken);
  const scopingConversation = createScopingConversation(deps);

  bot.use(async (ctx, next) => {
    const incomingText = formatIncomingText(ctx);
    if (incomingText) {
      console.log(`[bot] incoming ${contextTag(ctx)} text="${incomingText}"`);
    } else {
      console.log(`[bot] incoming ${contextTag(ctx)} update=${Object.keys(ctx.update).join(',')}`);
    }
    await next();
  });

  bot.use(conversations());
  bot.use(createConversation(scopingConversation, SCOPING_CONVERSATION));

  registerNewCommand(bot, deps);
  registerSiteCommand(bot, deps);

  bot.command('help', async (ctx) => {
    console.log(`[bot] /help ${contextTag(ctx)}`);
    await ctx.reply(
      [
        'Available commands:',
        '/new <topic> - create a new scoped research project',
        '/site - show the current project site URL',
        '/help - show this help message',
      ].join('\n'),
    );
  });

  bot.catch((err) => {
    console.error('Telegram bot error:', err.error);
  });

  return bot;
}
