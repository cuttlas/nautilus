import type { Bot } from 'grammy';
import { readBacklog } from '../../project/backlog.js';
import { readProject } from '../../project/project.js';
import type { BotDependencies, NautilusBotContext } from '../types.js';

function contextTag(ctx: NautilusBotContext): string {
  const chatId = ctx.chat?.id ?? 'unknown';
  const userId = ctx.from?.id ?? 'unknown';
  return `chat=${chatId} user=${userId}`;
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function registerStatusCommand(bot: Bot<NautilusBotContext>, deps: BotDependencies): void {
  bot.command('status', async (ctx) => {
    console.log(`[status] /status received ${contextTag(ctx)}`);
    const project = await readProject(deps.repo);

    if (!project) {
      await ctx.reply('No project found yet. Start one with /new <topic>.');
      return;
    }

    const backlog = await readBacklog(deps.repo);
    const completed = backlog.tasks.filter((t) => t.status === 'completed').length;
    const failed = backlog.tasks.filter((t) => t.status === 'failed').length;
    const total = backlog.tasks.length;
    const nextTask = backlog.tasks.find((t) => t.status === 'queued');
    const inProgress = backlog.tasks.find((t) => t.status === 'in_progress');

    const lines: string[] = [
      `Project: ${project.title}`,
      `Status: ${project.status}`,
      `Progress: ${completed}/${total} tasks completed${failed > 0 ? ` (${failed} failed)` : ''}`,
    ];

    if (inProgress) {
      lines.push(`In progress: ${inProgress.title}`);
    } else if (nextTask) {
      lines.push(`Next up: ${nextTask.title}`);
    }

    lines.push(`Last activity: ${formatRelativeTime(project.updatedAt)}`);
    lines.push(`Site: ${project.siteUrl}`);

    await ctx.reply(lines.join('\n'));
  });
}
