import type { Bot } from 'grammy';
import {
  sendProjectCompletedNotification,
  sendTaskCompletedNotification,
  sendTaskFailedNotification,
} from '../bot/notifications.js';
import type { NautilusConfig } from '../config.js';
import { writeContentFile } from '../content/writer.js';
import type { DataRepo } from '../git/sync.js';
import { readBacklog, requeueInProgressTasks, updateTask } from '../project/backlog.js';
import { readProject, writeProject } from '../project/project.js';
import { findSectionBySlug, readSchema } from '../project/schema.js';
import { generateAstroContentArtifacts } from '../site/generate.js';
import { runResearchTask } from './agent.js';

interface HeartbeatDependencies {
  config: NautilusConfig;
  repo: DataRepo;
  bot: Bot<any>;
}

export interface HeartbeatController {
  stop: () => void;
  runNow: () => Promise<void>;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safeNotify(fn: () => Promise<void>, label: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error(`[heartbeat] notification failed (${label}):`, error);
  }
}

async function runHeartbeatCycle(input: HeartbeatDependencies): Promise<void> {
  const project = await readProject(input.repo);
  if (!project) {
    console.log('[heartbeat] skipping: project.json not found');
    return;
  }

  if (project.status === 'paused' || project.status === 'completed' || project.status === 'scoping') {
    console.log(`[heartbeat] skipping: project status is ${project.status}`);
    return;
  }

  const backlog = await readBacklog(input.repo);
  if (backlog.tasks.some((task) => task.status === 'in_progress')) {
    console.log('[heartbeat] skipping: task already in progress');
    return;
  }

  const task = backlog.tasks.find((candidate) => candidate.status === 'queued');
  if (!task) {
    if (backlog.tasks.length === 0) {
      console.log('[heartbeat] skipping: backlog is empty (waiting for /add)');
      return;
    }
    project.status = 'completed';
    project.updatedAt = new Date().toISOString();
    await writeProject(input.repo, project);
    await generateAstroContentArtifacts(input.repo);
    await input.repo.commitAndPush('Mark project completed: no queued tasks remain');
    await safeNotify(
      () =>
        sendProjectCompletedNotification({
          bot: input.bot,
          chatId: input.config.telegramChatId,
          projectTitle: project.title,
        }),
      'project completed',
    );
    console.log('[heartbeat] project completed');
    return;
  }

  await updateTask(input.repo, task.id, { status: 'in_progress' });
  console.log(`[heartbeat] processing task ${task.id} "${task.title}"`);

  try {
    const schema = await readSchema(input.repo);
    const section = findSectionBySlug(schema, task.category);
    const result = await runResearchTask({
      config: input.config,
      projectScope: project.scope,
      task,
      sectionTitle: section?.title ?? task.category,
      sectionDescription: section?.description ?? '',
    });

    const researchedAt = new Date().toISOString();
    const outputPath = await writeContentFile({
      repo: input.repo,
      task,
      markdown: result.markdown,
      sources: result.sources,
      researchedAt,
    });

    await updateTask(input.repo, task.id, {
      status: 'completed',
      outputPath,
      completedAt: researchedAt,
    });

    project.updatedAt = researchedAt;
    await writeProject(input.repo, project);
    await generateAstroContentArtifacts(input.repo);
    await input.repo.commitAndPush(`Complete research task: ${task.title}`);
    await safeNotify(
      () =>
        sendTaskCompletedNotification({
          bot: input.bot,
          chatId: input.config.telegramChatId,
          taskTitle: task.title,
          siteUrl: project.siteUrl,
          outputPath,
          followUpTopics: result.followUpTopics,
        }),
      `task completed ${task.id}`,
    );
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    console.error(`[heartbeat] task failed ${task.id}:`, error);

    await updateTask(input.repo, task.id, { status: 'failed' });
    project.updatedAt = new Date().toISOString();
    await writeProject(input.repo, project);
    try {
      await generateAstroContentArtifacts(input.repo);
    } catch (artifactsError) {
      console.error(`[heartbeat] failed to generate site artifacts after task failure ${task.id}:`, artifactsError);
    }
    await input.repo.commitAndPush(`Mark research task failed: ${task.title}`);
    await safeNotify(
      () =>
        sendTaskFailedNotification({
          bot: input.bot,
          chatId: input.config.telegramChatId,
          taskTitle: task.title,
          errorMessage,
        }),
      `task failed ${task.id}`,
    );
  }
}

export function startHeartbeat(input: HeartbeatDependencies): HeartbeatController {
  const intervalMs = input.config.heartbeatIntervalMinutes * 60_000;
  let running = false;
  let stopped = false;
  let startupRecoveryDone = false;

  const runNow = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      if (!startupRecoveryDone) {
        const recovered = await requeueInProgressTasks(input.repo);
        startupRecoveryDone = true;
        if (recovered > 0) {
          console.warn(`[heartbeat] recovered ${recovered} stuck in_progress task(s) to queued`);
        }
      }
      await runHeartbeatCycle(input);
    } catch (error) {
      console.error('[heartbeat] unhandled cycle error:', error);
    } finally {
      running = false;
    }
  };

  void runNow();
  const timer = setInterval(() => {
    void runNow();
  }, intervalMs);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    console.log('[heartbeat] stopped');
  };

  return { stop, runNow };
}
