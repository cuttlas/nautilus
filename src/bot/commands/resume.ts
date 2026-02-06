import type { Bot } from 'grammy';
import { readBacklog } from '../../project/backlog.js';
import { readProject, writeProject } from '../../project/project.js';
import type { BotDependencies, NautilusBotContext } from '../types.js';

function contextTag(ctx: NautilusBotContext): string {
  const chatId = ctx.chat?.id ?? 'unknown';
  const userId = ctx.from?.id ?? 'unknown';
  return `chat=${chatId} user=${userId}`;
}

export function registerResumeCommand(bot: Bot<NautilusBotContext>, deps: BotDependencies): void {
  bot.command('resume', async (ctx) => {
    console.log(`[resume] /resume received ${contextTag(ctx)}`);
    const project = await readProject(deps.repo);

    if (!project) {
      await ctx.reply('No project found yet. Start one with /new <topic>.');
      return;
    }

    if (project.status === 'active') {
      await ctx.reply('Research is already running.');
      return;
    }

    if (project.status !== 'paused') {
      await ctx.reply(`Can't resume: project is ${project.status}.`);
      return;
    }

    project.status = 'active';
    project.updatedAt = new Date().toISOString();
    await writeProject(deps.repo, project);
    await deps.repo.commitAndPush('Resume research heartbeat');

    const backlog = await readBacklog(deps.repo);
    const nextTask = backlog.tasks.find((t) => t.status === 'queued');

    if (nextTask) {
      await ctx.reply(`Research resumed. Next task: ${nextTask.title}`);
    } else {
      await ctx.reply('Research resumed, but the backlog is empty. Use /add <topic> to add tasks.');
    }
  });
}
