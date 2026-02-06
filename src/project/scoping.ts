import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { NautilusConfig } from '../config.js';
import type { DataRepo } from '../git/sync.js';
import {
  buildScopingPlanPrompt,
  buildScopingRetryPrompt,
  buildScopingTasksPrompt,
  buildScopingTurnPrompt,
  SCOPING_PLAN_SYSTEM_PROMPT,
  SCOPING_SYSTEM_PROMPT,
  SCOPING_TASKS_SYSTEM_PROMPT,
} from '../research/prompts.js';
import type { DocumentSchema, Project } from '../types.js';
import { setQueuedTasks } from './backlog.js';
import { writeProject } from './project.js';
import { writeSchema } from './schema.js';

export const MIN_SCOPING_QUESTIONS = 5;
export const MAX_SCOPING_QUESTIONS = 10;
const MIN_SCHEMA_SECTIONS = 4;
const MAX_SCHEMA_SECTIONS = 10;
const TARGET_INITIAL_TASKS = 10;
const MIN_INITIAL_TASKS = 8;
const MAX_INITIAL_TASKS = 12;

const scopingTurnSchema = z.object({
  assistantMessage: z
    .string()
    .min(1)
    .describe('One short message to send to the user, either a question or completion transition.'),
  isComplete: z
    .boolean()
    .describe('True only when enough scoping context has been collected.'),
});

const scopingPlanSchema = z.object({
  title: z.string().min(3),
  scope: z.string().min(40),
  schema: z.object({
    title: z.string().min(3),
    description: z.string().min(10),
    sections: z
      .array(
        z.object({
          slug: z.string().min(2),
          title: z.string().min(2),
          description: z.string().min(5),
          order: z.number().int().nonnegative().optional(),
          subsections: z
            .array(
              z.object({
                slug: z.string().min(2),
                title: z.string().min(2),
                description: z.string().min(5).optional(),
              }),
            )
            .min(1)
            .max(6),
        }),
      )
      .min(MIN_SCHEMA_SECTIONS)
      .max(MAX_SCHEMA_SECTIONS),
  }),
});

type ScopingPlan = z.infer<typeof scopingPlanSchema>;
type TaskInput = { title: string; description: string; category: string };

interface ScopingSection {
  slug: string;
  title: string;
  description: string;
  order: number;
  subsections: Array<{
    slug: string;
    title: string;
    description: string;
    taskDefs: Array<{ title: string; description: string }>;
  }>;
}

export interface ScopingMessage {
  role: 'assistant' | 'user';
  content: string;
}

export interface ScopingTurnResult {
  assistantMessage: string;
  isComplete: boolean;
}

export interface FinalizeScopingInput {
  topic: string;
  history: ScopingMessage[];
  scopingAnswers: Record<string, string>;
}

export interface FinalizedScopingResult {
  project: Project;
  taskCount: number;
  sections: Array<{ title: string; taskCount: number }>;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function uniqueSlug(input: string, used: Set<string>, fallbackPrefix: string): string {
  let base = slugify(input);
  if (!base) base = fallbackPrefix;
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function formatHistory(history: ScopingMessage[]): string {
  return history.map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join('\n');
}

function sectionTaskCount(section: DocumentSchema['sections'][number]): number {
  return section.subsections.reduce((sum, subsection) => sum + subsection.taskIds.length, 0);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function generateObjectWithRetry<T>(input: {
  config: NautilusConfig;
  schema: z.ZodType<T>;
  system: string;
  primaryPrompt: string;
  retryLabel: string;
}): Promise<T> {
  try {
    const { object } = await generateObject({
      model: anthropic(input.config.defaultModel),
      schema: input.schema,
      system: input.system,
      prompt: input.primaryPrompt,
    });
    return object;
  } catch (firstError) {
    console.warn(`[scoping] ${input.retryLabel} validation failed; retrying once`, firstError);

    const { object } = await generateObject({
      model: anthropic(input.config.defaultModel),
      schema: input.schema,
      system: input.system,
      prompt: buildScopingRetryPrompt({
        retryLabel: input.retryLabel,
        validationError: getErrorMessage(firstError),
        previousPrompt: input.primaryPrompt,
      }),
    });

    return object;
  }
}

function resolveSection(sectionDefs: ScopingSection[], rawSlug: string): ScopingSection | undefined {
  const normalized = slugify(rawSlug);
  return sectionDefs.find(
    (section) => section.slug === normalized || slugify(section.title) === normalized,
  );
}

function resolveSubsection(
  section: ScopingSection,
  rawSlug: string,
): ScopingSection['subsections'][number] | undefined {
  const normalized = slugify(rawSlug);
  return section.subsections.find(
    (subsection) => subsection.slug === normalized || slugify(subsection.title) === normalized,
  );
}

function buildSchemaSummaryForTaskPrompt(sectionDefs: ScopingSection[]): string {
  return JSON.stringify(
    sectionDefs.map((section) => ({
      slug: section.slug,
      title: section.title,
      description: section.description,
      subsections: section.subsections.map((subsection) => ({
        slug: subsection.slug,
        title: subsection.title,
        description: subsection.description,
      })),
    })),
    null,
    2,
  );
}

function createScopingTasksSchema(sectionDefs: ScopingSection[]) {
  const sectionSlugs = new Set(sectionDefs.map((section) => section.slug));
  const subsectionSlugs = new Set(
    sectionDefs.flatMap((section) => section.subsections.map((subsection) => subsection.slug)),
  );
  const validPairs = new Set(
    sectionDefs.flatMap((section) =>
      section.subsections.map((subsection) => `${section.slug}/${subsection.slug}`),
    ),
  );

  return z
    .object({
      tasks: z
        .array(
          z.object({
            title: z.string().min(5),
            description: z.string().min(20),
            categorySlug: z.string().refine((value) => sectionSlugs.has(value), {
              message: 'categorySlug must be one of the provided section slugs',
            }),
            subsectionSlug: z.string().refine((value) => subsectionSlugs.has(value), {
              message: 'subsectionSlug must be one of the provided subsection slugs',
            }),
          }),
        )
        .min(MIN_INITIAL_TASKS)
        .max(MAX_INITIAL_TASKS),
    })
    .superRefine((value, ctx) => {
      value.tasks.forEach((task, index) => {
        if (!validPairs.has(`${task.categorySlug}/${task.subsectionSlug}`)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'subsectionSlug does not belong to categorySlug',
            path: ['tasks', index, 'subsectionSlug'],
          });
        }
      });
    });
}

function buildFlattenedTasks(sectionDefs: ScopingSection[]): TaskInput[] {
  const flattened: TaskInput[] = [];
  for (const section of sectionDefs) {
    for (const subsection of section.subsections) {
      for (const task of subsection.taskDefs) {
        flattened.push({
          title: task.title,
          description: task.description,
          category: section.slug,
        });
      }
    }
  }
  return flattened;
}

function mapTaskIdsIntoSchema(
  sectionDefs: ScopingSection[],
  queuedTasks: Array<{ id: string }>,
): DocumentSchema {
  let cursor = 0;
  return {
    title: '',
    description: '',
    sections: sectionDefs.map((section) => ({
      slug: section.slug,
      title: section.title,
      description: section.description,
      order: section.order,
      subsections: section.subsections.map((subsection) => {
        const taskIds = subsection.taskDefs.map(() => {
          const taskId = queuedTasks[cursor]?.id;
          cursor += 1;
          if (!taskId) {
            throw new Error('Task mapping failed while building schema');
          }
          return taskId;
        });

        return {
          slug: subsection.slug,
          title: subsection.title,
          taskIds,
        };
      }),
    })),
  };
}

function normalizePlanSections(plan: ScopingPlan): ScopingSection[] {
  const sectionSlugSet = new Set<string>();
  const subsectionSlugSet = new Set<string>();

  return plan.schema.sections
    .map((section, sectionIndex) => ({
      slug: uniqueSlug(section.slug || section.title, sectionSlugSet, `section-${sectionIndex + 1}`),
      title: section.title,
      description: section.description,
      order: section.order ?? sectionIndex,
      subsections: section.subsections.map((subsection, subsectionIndex) => ({
        slug: uniqueSlug(
          subsection.slug || subsection.title,
          subsectionSlugSet,
          `subsection-${sectionIndex + 1}-${subsectionIndex + 1}`,
        ),
        title: subsection.title,
        description: subsection.description ?? subsection.title,
        taskDefs: [] as Array<{ title: string; description: string }>,
      })),
    }))
    .sort((a, b) => a.order - b.order)
    .map((section, index) => ({
      ...section,
      order: index,
    }));
}

function assignGeneratedTasks(
  sectionDefs: ScopingSection[],
  generatedTasks: Array<{
    title: string;
    description: string;
    categorySlug: string;
    subsectionSlug: string;
  }>,
): void {
  const seenTaskTitles = new Set<string>();

  for (const task of generatedTasks) {
    const normalizedTitle = task.title.trim().toLowerCase();
    if (seenTaskTitles.has(normalizedTitle)) {
      continue;
    }
    seenTaskTitles.add(normalizedTitle);

    const section = resolveSection(sectionDefs, task.categorySlug);
    if (!section) {
      throw new Error(`Generated task references unknown categorySlug: ${task.categorySlug}`);
    }

    const subsection = resolveSubsection(section, task.subsectionSlug);
    if (!subsection) {
      throw new Error(
        `Generated task references unknown subsectionSlug in ${section.slug}: ${task.subsectionSlug}`,
      );
    }

    subsection.taskDefs.push({
      title: task.title,
      description: task.description,
    });
  }

  const assignedTaskCount = buildFlattenedTasks(sectionDefs).length;
  if (assignedTaskCount < MIN_INITIAL_TASKS) {
    throw new Error(
      `Too few valid generated tasks after dedupe/mapping: ${assignedTaskCount}. Expected at least ${MIN_INITIAL_TASKS}.`,
    );
  }
}

export async function runScopingConversation(input: {
  config: NautilusConfig;
  topic: string;
  history: ScopingMessage[];
  askedQuestions: number;
}): Promise<ScopingTurnResult> {
  const { object } = await generateObject({
    model: anthropic(input.config.defaultModel),
    schema: scopingTurnSchema,
    system: SCOPING_SYSTEM_PROMPT,
    prompt: buildScopingTurnPrompt({
      topic: input.topic,
      askedQuestions: input.askedQuestions,
      minQuestions: MIN_SCOPING_QUESTIONS,
      maxQuestions: MAX_SCOPING_QUESTIONS,
      conversation: formatHistory(input.history),
    }),
  });

  return object;
}

export async function finalizeScoping(
  repo: DataRepo,
  config: NautilusConfig,
  input: FinalizeScopingInput,
): Promise<FinalizedScopingResult> {
  const planObject = await generateObjectWithRetry({
    config,
    schema: scopingPlanSchema,
    system: SCOPING_PLAN_SYSTEM_PROMPT,
    primaryPrompt: buildScopingPlanPrompt({
      topic: input.topic,
      conversation: formatHistory(input.history),
      minSections: MIN_SCHEMA_SECTIONS,
      maxSections: MAX_SCHEMA_SECTIONS,
    }),
    retryLabel: 'scoping plan',
  });

  const sectionDefs = normalizePlanSections(planObject);
  const scopingTasksSchema = createScopingTasksSchema(sectionDefs);

  const taskObject = await generateObjectWithRetry({
    config,
    schema: scopingTasksSchema,
    system: SCOPING_TASKS_SYSTEM_PROMPT,
    primaryPrompt: buildScopingTasksPrompt({
      topic: input.topic,
      projectTitle: planObject.title,
      projectScope: planObject.scope,
      schemaSummaryJson: buildSchemaSummaryForTaskPrompt(sectionDefs),
      targetTasks: TARGET_INITIAL_TASKS,
      minTasks: MIN_INITIAL_TASKS,
      maxTasks: MAX_INITIAL_TASKS,
    }),
    retryLabel: 'scoping tasks',
  });

  assignGeneratedTasks(sectionDefs, taskObject.tasks);

  const flattenedTasks = buildFlattenedTasks(sectionDefs);
  const queuedTasks = await setQueuedTasks(repo, flattenedTasks);

  const schema = mapTaskIdsIntoSchema(sectionDefs, queuedTasks);
  schema.title = planObject.schema.title;
  schema.description = planObject.schema.description;
  await writeSchema(repo, schema);

  const now = new Date().toISOString();
  const projectSlug = slugify(planObject.title || input.topic) || 'project';

  const project: Project = {
    id: uuidv4(),
    slug: projectSlug,
    title: planObject.title,
    scope: planObject.scope,
    scopingAnswers: input.scopingAnswers,
    status: 'active',
    heartbeatIntervalMinutes: config.heartbeatIntervalMinutes,
    model: config.defaultModel,
    createdAt: now,
    updatedAt: now,
    siteUrl: config.siteUrl,
  };

  await writeProject(repo, project);

  const sections = schema.sections.map((section) => ({
    title: section.title,
    taskCount: sectionTaskCount(section),
  }));

  return {
    project,
    taskCount: queuedTasks.length,
    sections,
  };
}
