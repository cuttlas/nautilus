import type { Bot } from 'grammy';
import { outputPathToPageRoute } from '../content/writer.js';

function joinSiteUrl(siteUrl: string, outputPath: string): string {
  const base = siteUrl.replace(/\/+$/g, '');
  const route = outputPathToPageRoute(outputPath).replace(/^\/+/, '');
  return `${base}/${route}`;
}

export interface TaskCompletedNotificationInput {
  bot: Bot<any>;
  chatId: string;
  taskTitle: string;
  siteUrl: string;
  outputPath: string;
  followUpTopics: string[];
}

export interface TaskFailedNotificationInput {
  bot: Bot<any>;
  chatId: string;
  taskTitle: string;
  errorMessage: string;
}

export interface ProjectCompletedNotificationInput {
  bot: Bot<any>;
  chatId: string;
  projectTitle: string;
}

export async function sendTaskCompletedNotification(
  input: TaskCompletedNotificationInput,
): Promise<void> {
  const pageUrl = joinSiteUrl(input.siteUrl, input.outputPath);
  const lines = [`✅ Completed: ${input.taskTitle}`, `🔗 ${pageUrl}`];

  if (input.followUpTopics.length > 0) {
    lines.push('');
    lines.push('💡 Follow-up topics discovered:');
    for (const topic of input.followUpTopics) {
      lines.push(`- ${topic}`);
    }
    lines.push('');
    lines.push('Use /add <topic> to research any of these.');
  }

  await input.bot.api.sendMessage(input.chatId, lines.join('\n'));
}

export async function sendTaskFailedNotification(input: TaskFailedNotificationInput): Promise<void> {
  const errorLine = input.errorMessage.length > 300
    ? `${input.errorMessage.slice(0, 297)}...`
    : input.errorMessage;

  await input.bot.api.sendMessage(
    input.chatId,
    [`❌ Research task failed: ${input.taskTitle}`, `Error: ${errorLine}`].join('\n'),
  );
}

export async function sendProjectCompletedNotification(
  input: ProjectCompletedNotificationInput,
): Promise<void> {
  await input.bot.api.sendMessage(
    input.chatId,
    `🎉 All backlog tasks are complete for "${input.projectTitle}".`,
  );
}
