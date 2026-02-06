import { outputPathToPageRoute } from '../content/writer.js';
import type { DataRepo } from '../git/sync.js';
import { readBacklog } from '../project/backlog.js';
import { readProject } from '../project/project.js';
import { readSchema } from '../project/schema.js';
import type { ResearchTask } from '../types.js';

type TaskStatus = ResearchTask['status'] | 'unknown';

interface TocTaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  route: string | null;
}

interface SitePageManifest {
  taskId: string;
  title: string;
  category: string;
  outputPath: string;
  route: string;
}

interface TocSectionSummary {
  slug: string;
  title: string;
  description: string;
  order: number;
  stats: {
    total: number;
    completed: number;
    queued: number;
    inProgress: number;
    failed: number;
  };
  subsections: Array<{
    slug: string;
    title: string;
    tasks: TocTaskSummary[];
  }>;
}

function asJsonFile(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function sortByRouteAndTitle(a: SitePageManifest, b: SitePageManifest): number {
  const byRoute = a.route.localeCompare(b.route);
  if (byRoute !== 0) return byRoute;
  return a.title.localeCompare(b.title);
}

function taskToStatus(task: ResearchTask | undefined): TaskStatus {
  if (!task) return 'unknown';
  return task.status;
}

function taskToRoute(task: ResearchTask | undefined): string | null {
  if (!task?.outputPath) return null;
  if (task.status !== 'completed') return null;
  return outputPathToPageRoute(task.outputPath);
}

function buildSectionSummary(input: {
  section: {
    slug: string;
    title: string;
    description: string;
    order: number;
    subsections: Array<{ slug: string; title: string; taskIds: string[] }>;
  };
  taskById: Map<string, ResearchTask>;
}): TocSectionSummary {
  const stats = {
    total: 0,
    completed: 0,
    queued: 0,
    inProgress: 0,
    failed: 0,
  };

  const subsections = input.section.subsections.map((subsection) => {
    const tasks = subsection.taskIds.map((taskId) => {
      const task = input.taskById.get(taskId);
      const status = taskToStatus(task);
      const route = taskToRoute(task);

      stats.total += 1;
      if (status === 'completed') stats.completed += 1;
      if (status === 'queued') stats.queued += 1;
      if (status === 'in_progress') stats.inProgress += 1;
      if (status === 'failed') stats.failed += 1;

      return {
        id: taskId,
        title: task?.title ?? `Missing task (${taskId.slice(0, 8)})`,
        status,
        route,
      };
    });

    return {
      slug: subsection.slug,
      title: subsection.title,
      tasks,
    };
  });

  return {
    slug: input.section.slug,
    title: input.section.title,
    description: input.section.description,
    order: input.section.order,
    stats,
    subsections,
  };
}

function buildPageManifest(tasks: ResearchTask[]): SitePageManifest[] {
  const routes = new Map<string, SitePageManifest>();
  for (const task of tasks) {
    if (task.status !== 'completed') continue;
    if (!task.outputPath) continue;

    const route = outputPathToPageRoute(task.outputPath);
    if (!route) continue;

    if (!routes.has(route)) {
      routes.set(route, {
        taskId: task.id,
        title: task.title,
        category: task.category,
        outputPath: task.outputPath,
        route,
      });
    }
  }

  return Array.from(routes.values()).sort(sortByRouteAndTitle);
}

export async function generateAstroContentArtifacts(repo: DataRepo): Promise<void> {
  const [project, schema, backlog] = await Promise.all([
    readProject(repo),
    readSchema(repo),
    readBacklog(repo),
  ]);

  const taskById = new Map(backlog.tasks.map((task) => [task.id, task]));
  const sections = schema.sections
    .map((section) => buildSectionSummary({ section, taskById }))
    .sort((a, b) => a.order - b.order);

  const pages = buildPageManifest(backlog.tasks);

  await repo.writeFile(
    'site/src/generated/toc.json',
    asJsonFile({
      generatedAt: new Date().toISOString(),
      project: {
        title: project?.title ?? '',
        scope: project?.scope ?? '',
        status: project?.status ?? 'scoping',
        updatedAt: project?.updatedAt ?? null,
        siteUrl: project?.siteUrl ?? '',
      },
      sections,
    }),
  );

  await repo.writeFile('site/src/generated/pages.json', asJsonFile(pages));
}
