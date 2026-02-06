import type { Bot } from 'grammy';
import { readProject, writeProject } from '../../project/project.js';
import type { BotDependencies, NautilusBotContext } from '../types.js';

function contextTag(ctx: NautilusBotContext): string {
  const chatId = ctx.chat?.id ?? 'unknown';
  const userId = ctx.from?.id ?? 'unknown';
  return `chat=${chatId} user=${userId}`;
}

export function registerPauseCommand(bot: Bot<NautilusBotContext>, deps: BotDependencies): void {
  bot.command('pause', async (ctx) => {
    console.log(`[pause] /pause received ${contextTag(ctx)}`);
    const project = await readProject(deps.repo);

    if (!project) {
      await ctx.reply('No project found yet. Start one with /new <topic>.');
      return;
    }

    if (project.status === 'paused') {
      await ctx.reply('Research is already paused. Use /resume to continue.');
      return;
    }

    if (project.status !== 'active') {
      await ctx.reply(`Can't pause: project is ${project.status}.`);
      return;
    }

    project.status = 'paused';
    project.updatedAt = new Date().toISOString();
    await writeProject(deps.repo, project);
    await deps.repo.commitAndPush('Pause research heartbeat');

    await ctx.reply('Research paused. Use /resume to continue.');
  });
}
