import { generateObject } from 'ai';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { NautilusConfig } from '../config.js';
import type { DataRepo } from '../git/sync.js';
import { resolveLanguageModel } from '../llm/provider.js';
import {
  buildScopingPlanPrompt,
  buildScopingRetryPrompt,
  buildScopingTurnPrompt,
  SCOPING_PLAN_SYSTEM_PROMPT,
  SCOPING_SYSTEM_PROMPT,
} from '../research/prompts.js';
import type { Project } from '../types.js';
import { generateAstroContentArtifacts } from '../site/generate.js';
import { scaffoldAstroSite } from '../site/scaffold.js';
import { setQueuedTasks } from './backlog.js';
import { writeProject } from './project.js';
import { writeSchema } from './schema.js';

export const MIN_SCOPING_QUESTIONS = 5;
export const MAX_SCOPING_QUESTIONS = 10;

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
});

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
}

export interface FinalizedScopingResult {
  project: Project;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function formatHistory(history: ScopingMessage[]): string {
  return history.map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join('\n');
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
      model: resolveLanguageModel(input.config),
      schema: input.schema,
      system: input.system,
      prompt: input.primaryPrompt,
    });
    return object;
  } catch (firstError) {
    console.warn(`[scoping] ${input.retryLabel} validation failed; retrying once`, firstError);

    const { object } = await generateObject({
      model: resolveLanguageModel(input.config),
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

async function purgePreviousProjectContent(repo: DataRepo): Promise<void> {
  await repo.removePath('content');
  await repo.removePath('site');
}

export async function runScopingConversation(input: {
  config: NautilusConfig;
  topic: string;
  history: ScopingMessage[];
  askedQuestions: number;
}): Promise<ScopingTurnResult> {
  const { object } = await generateObject({
    model: resolveLanguageModel(input.config),
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
    }),
    retryLabel: 'scoping plan',
  });

  await purgePreviousProjectContent(repo);
  await setQueuedTasks(repo, []);
  await writeSchema(repo, {
    title: planObject.title,
    description: planObject.scope,
    sections: [],
  });

  const now = new Date().toISOString();
  const projectSlug = slugify(planObject.title || input.topic) || 'project';

  const project: Project = {
    id: uuidv4(),
    slug: projectSlug,
    title: planObject.title,
    scope: planObject.scope,
    status: 'active',
    heartbeatIntervalMinutes: config.heartbeatIntervalMinutes,
    model: config.defaultModel,
    createdAt: now,
    updatedAt: now,
    siteUrl: config.siteUrl,
  };

  await writeProject(repo, project);
  await scaffoldAstroSite(repo);
  await generateAstroContentArtifacts(repo);

  return { project };
}
