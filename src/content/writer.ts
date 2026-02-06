import type { DataRepo } from '../git/sync.js';
import type { ResearchTask } from '../types.js';
import { generateFrontmatter, type SourceRef } from './frontmatter.js';

export interface WriteContentFileInput {
  repo: DataRepo;
  task: ResearchTask;
  markdown: string;
  sources: SourceRef[];
  researchedAt: string;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function buildTopicOutputPath(task: Pick<ResearchTask, 'title' | 'category' | 'id'>): string {
  const categorySlug = slugify(task.category) || 'general';
  const topicSlug = slugify(task.title) || task.id;
  return `content/${categorySlug}/${topicSlug}.md`;
}

export function outputPathToPageRoute(outputPath: string): string {
  return outputPath.replace(/^content\//, '').replace(/\.md$/i, '');
}

export async function writeContentFile(input: WriteContentFileInput): Promise<string> {
  const outputPath = buildTopicOutputPath(input.task);
  const frontmatter = generateFrontmatter({
    title: input.task.title,
    category: input.task.category,
    sources: input.sources,
    researchedAt: input.researchedAt,
  });
  const body = input.markdown.trim();
  const fullContent = `${frontmatter}\n\n${body}\n`;

  await input.repo.writeFile(outputPath, fullContent);
  return outputPath;
}
