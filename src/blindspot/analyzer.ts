import { generateObject } from 'ai';
import { z } from 'zod';
import type { NautilusConfig } from '../config.js';
import type { DataRepo } from '../git/sync.js';
import { resolveLanguageModel } from '../llm/provider.js';
import { readBacklog } from '../project/backlog.js';
import { readProject } from '../project/project.js';
import { readSchema } from '../project/schema.js';

const blindspotSchema = z.object({
  suggestions: z.array(
    z.object({
      title: z.string().min(5),
      rationale: z.string().min(20),
    }),
  ),
});

const BLINDSPOT_SYSTEM_PROMPT = [
  'You are Nautilus, a research coverage analyst.',
  'Analyze the project scope, completed research, and current backlog to identify blindspots.',
  'Focus on:',
  '- Practical day-to-day concerns a first-timer would not know to ask about',
  '- Cross-cutting concerns that span multiple categories',
  '- Recent developments or changes (2025-2026)',
  '- Edge cases and common gotchas',
  '- Topics adjacent to existing research that add clear value',
  'Do not suggest topics already covered by completed or queued tasks.',
  'Each suggestion must be specific and narrow enough for one research cycle.',
  'Return only valid structured output.',
].join('\n');

export interface BlindspotSuggestion {
  title: string;
  rationale: string;
}

export interface AnalyzeBlindspotInput {
  config: NautilusConfig;
  repo: DataRepo;
}

function buildSchemaSummary(schema: {
  sections: Array<{
    slug: string;
    title: string;
    description: string;
    subsections: Array<{ slug: string; title: string }>;
  }>;
}): string {
  return JSON.stringify(
    schema.sections.map((s) => ({
      slug: s.slug,
      title: s.title,
      description: s.description,
      subsections: s.subsections.map((sub) => ({
        slug: sub.slug,
        title: sub.title,
      })),
    })),
    null,
    2,
  );
}

function buildContextPrompt(input: {
  projectScope: string;
  schemaSummary: string;
  completedTaskTitles: string[];
  queuedTaskTitles: string[];
  maxSuggestions: number;
}): string {
  return [
    'Project scope:',
    input.projectScope,
    '',
    'Document schema (categories and subsections):',
    input.schemaSummary,
    '',
    'Completed tasks:',
    ...(input.completedTaskTitles.length > 0
      ? input.completedTaskTitles.map((t) => `- ${t}`)
      : ['(none yet)']),
    '',
    'Queued tasks (backlog):',
    ...(input.queuedTaskTitles.length > 0
      ? input.queuedTaskTitles.map((t) => `- ${t}`)
      : ['(none)']),
    '',
    `Return up to ${input.maxSuggestions} blindspot suggestions.`,
  ].join('\n');
}

export async function analyzeBlindspots(
  input: AnalyzeBlindspotInput,
): Promise<BlindspotSuggestion[]> {
  const project = await readProject(input.repo);
  if (!project) return [];

  const [schema, backlog] = await Promise.all([
    readSchema(input.repo),
    readBacklog(input.repo),
  ]);

  const completedTaskTitles = backlog.tasks
    .filter((t) => t.status === 'completed')
    .map((t) => t.title);

  const queuedTaskTitles = backlog.tasks
    .filter((t) => t.status === 'queued')
    .map((t) => t.title);

  const prompt = buildContextPrompt({
    projectScope: project.scope,
    schemaSummary: buildSchemaSummary(schema),
    completedTaskTitles,
    queuedTaskTitles,
    maxSuggestions: 5,
  });

  const { object } = await generateObject({
    model: resolveLanguageModel(input.config),
    schema: blindspotSchema,
    system: BLINDSPOT_SYSTEM_PROMPT,
    prompt,
  });

  return object.suggestions;
}
