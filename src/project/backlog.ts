import { v4 as uuidv4 } from 'uuid';
import type { DataRepo } from '../git/sync.js';
import type { Backlog, ResearchTask } from '../types.js';

const BACKLOG_FILE = 'backlog.json';

export async function readBacklog(repo: DataRepo): Promise<Backlog> {
  try {
    return await repo.readJSON<Backlog>(BACKLOG_FILE);
  } catch {
    return { tasks: [] };
  }
}

export async function addTask(
  repo: DataRepo,
  input: { title: string; description: string; category: string },
): Promise<ResearchTask> {
  const backlog = await readBacklog(repo);

  const task: ResearchTask = {
    id: uuidv4(),
    title: input.title,
    description: input.description,
    category: input.category,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };

  backlog.tasks.unshift(task);
  await repo.writeJSON(BACKLOG_FILE, backlog);
  return task;
}

function createQueuedTask(input: {
  title: string;
  description: string;
  category: string;
}): ResearchTask {
  return {
    id: uuidv4(),
    title: input.title,
    description: input.description,
    category: input.category,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
}

export async function addTasks(
  repo: DataRepo,
  inputs: Array<{ title: string; description: string; category: string }>,
): Promise<ResearchTask[]> {
  const backlog = await readBacklog(repo);
  const tasks: ResearchTask[] = inputs.map(createQueuedTask);

  backlog.tasks.push(...tasks);
  await repo.writeJSON(BACKLOG_FILE, backlog);
  return tasks;
}

export async function setQueuedTasks(
  repo: DataRepo,
  inputs: Array<{ title: string; description: string; category: string }>,
): Promise<ResearchTask[]> {
  const tasks = inputs.map(createQueuedTask);
  await repo.writeJSON(BACKLOG_FILE, { tasks } satisfies Backlog);
  return tasks;
}

export async function pickNextTask(repo: DataRepo): Promise<ResearchTask | null> {
  const backlog = await readBacklog(repo);
  return backlog.tasks.find((t) => t.status === 'queued') ?? null;
}

export async function updateTask(
  repo: DataRepo,
  taskId: string,
  updates: Partial<Pick<ResearchTask, 'status' | 'completedAt' | 'outputPath'>>,
): Promise<ResearchTask> {
  const backlog = await readBacklog(repo);
  const task = backlog.tasks.find((t) => t.id === taskId);

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  Object.assign(task, updates);
  await repo.writeJSON(BACKLOG_FILE, backlog);
  return task;
}
