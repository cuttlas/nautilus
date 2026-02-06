import type { Bot } from 'grammy';
import { readBacklog } from '../../project/backlog.js';
import { readProject } from '../../project/project.js';
import { readSchema } from '../../project/schema.js';
import type { BotDependencies, NautilusBotContext } from '../types.js';

function contextTag(ctx: NautilusBotContext): string {
  const chatId = ctx.chat?.id ?? 'unknown';
  const userId = ctx.from?.id ?? 'unknown';
  return `chat=${chatId} user=${userId}`;
}

export function registerBacklogCommand(bot: Bot<NautilusBotContext>, deps: BotDependencies): void {
  bot.command('backlog', async (ctx) => {
    console.log(`[backlog] /backlog received ${contextTag(ctx)}`);
    const project = await readProject(deps.repo);

    if (!project) {
      await ctx.reply('No project found yet. Start one with /new <topic>.');
      return;
    }

    const backlog = await readBacklog(deps.repo);
    const queued = backlog.tasks.filter((t) => t.status === 'queued');

    if (queued.length === 0) {
      await ctx.reply('Backlog is empty. All tasks are completed!');
      return;
    }

    const schema = await readSchema(deps.repo);
    const categoryTitles = new Map(schema.sections.map((s) => [s.slug, s.title]));

    const grouped = new Map<string, string[]>();
    for (const task of queued) {
      const tasks = grouped.get(task.category) ?? [];
      tasks.push(task.title);
      grouped.set(task.category, tasks);
    }

    const lines: string[] = [`Backlog: ${queued.length} tasks pending`, ''];

    for (const [category, tasks] of grouped) {
      const title = categoryTitles.get(category) ?? category;
      lines.push(`${title} (${tasks.length})`);
      for (const taskTitle of tasks) {
        lines.push(`  - ${taskTitle}`);
      }
      lines.push('');
    }

    await ctx.reply(lines.join('\n').trimEnd());
  });
}
