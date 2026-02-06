import { generateObject } from 'ai';
import type { Bot } from 'grammy';
import { z } from 'zod';
import { resolveLanguageModel } from '../../llm/provider.js';
import { addTask } from '../../project/backlog.js';
import { readProject, writeProject } from '../../project/project.js';
import { readSchema, writeSchema } from '../../project/schema.js';
import type { DocumentSchema, SchemaSection } from '../../types.js';
import type { BotDependencies, NautilusBotContext } from '../types.js';

const NEW_CATEGORY_SENTINEL = '__new__';

const addTopicSchema = z.object({
  title: z.string().min(5),
  description: z.string().min(20),
  categorySlug: z.string().min(1),
  newCategoryTitle: z.string().min(2).optional(),
  newCategoryDescription: z.string().min(10).optional(),
});

type ParsedAddTopic = z.infer<typeof addTopicSchema>;

function contextTag(ctx: NautilusBotContext): string {
  const chatId = ctx.chat?.id ?? 'unknown';
  const userId = ctx.from?.id ?? 'unknown';
  return `chat=${chatId} user=${userId}`;
}

function parseTopic(text: string): string {
  return text.replace(/^\/add(@\w+)?/i, '').trim();
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
  if (!base) {
    base = fallbackPrefix;
  }

  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildSchemaSummary(schema: DocumentSchema): string {
  return JSON.stringify(
    schema.sections.map((section) => ({
      slug: section.slug,
      title: section.title,
      description: section.description,
    })),
    null,
    2,
  );
}

async function parseAddTopicWithLlm(input: {
  deps: BotDependencies;
  topic: string;
  schema: DocumentSchema;
  projectScope: string;
}): Promise<ParsedAddTopic> {
  const { object } = await generateObject({
    model: resolveLanguageModel(input.deps.config),
    schema: addTopicSchema,
    system: [
      'You map a user /add topic into a structured research task for Nautilus.',
      `If no existing category fits, set categorySlug to "${NEW_CATEGORY_SENTINEL}" and provide newCategoryTitle/newCategoryDescription.`,
      'When the schema has no sections yet, always create a new category with a descriptive title that fits the project scope.',
      'Task title must be concise and specific.',
      'Task description must be actionable and narrow enough for one research cycle.',
      'Return only valid structured output.',
    ].join('\n'),
    prompt: [
      'User /add input:',
      input.topic,
      '',
      'Project scope:',
      input.projectScope,
      '',
      'Existing schema categories (JSON):',
      buildSchemaSummary(input.schema),
    ].join('\n'),
  });

  return object;
}

function findSectionByLooseSlug(
  schema: DocumentSchema,
  rawSlug: string,
): SchemaSection | undefined {
  const normalized = slugify(rawSlug);
  return schema.sections.find(
    (section) => section.slug === normalized || slugify(section.title) === normalized,
  );
}

function addNewSection(input: {
  schema: DocumentSchema;
  requestedTitle: string;
  requestedDescription: string;
}): SchemaSection {
  const sectionSlugSet = new Set(input.schema.sections.map((section) => section.slug));
  const sectionOrder = input.schema.sections.reduce((maxOrder, section) => Math.max(maxOrder, section.order), -1) + 1;

  const section: SchemaSection = {
    slug: uniqueSlug(input.requestedTitle, sectionSlugSet, 'new-category'),
    title: normalizeText(input.requestedTitle) || 'Additional Topics',
    description: normalizeText(input.requestedDescription) || 'Additional ad hoc user-requested research topics.',
    order: sectionOrder,
    taskIds: [],
  };

  input.schema.sections.push(section);
  input.schema.sections.sort((a, b) => a.order - b.order);
  return section;
}

export function registerAddCommand(bot: Bot<NautilusBotContext>, deps: BotDependencies): void {
  bot.command('add', async (ctx) => {
    const topic = parseTopic(ctx.message?.text ?? '');
    if (!topic) {
      console.log(`[add] missing topic ${contextTag(ctx)}`);
      await ctx.reply('Usage: /add <topic>');
      return;
    }

    console.log(`[add] /add received ${contextTag(ctx)} topic="${topic}"`);
    const project = await readProject(deps.repo);
    if (!project) {
      await ctx.reply('No project found. Use /new <topic> first.');
      return;
    }

    if (project.status === 'scoping') {
      await ctx.reply('Scoping is still in progress. Please finish /new before adding tasks.');
      return;
    }

    const schema = await readSchema(deps.repo);

    let parsed: ParsedAddTopic;
    try {
      parsed = await parseAddTopicWithLlm({
        deps,
        topic,
        schema,
        projectScope: project.scope,
      });
    } catch (error) {
      console.error('[add] failed to parse /add input:', error);
      await ctx.reply('I could not parse that topic into a task. Please try a more specific /add request.');
      return;
    }

    const normalizedTitle = normalizeText(parsed.title);
    const normalizedDescription = normalizeText(parsed.description);

    let section = findSectionByLooseSlug(schema, parsed.categorySlug);

    if (!section || parsed.categorySlug === NEW_CATEGORY_SENTINEL) {
      const requestedTitle =
        normalizeText(parsed.newCategoryTitle ?? '') ||
        normalizeText(parsed.categorySlug === NEW_CATEGORY_SENTINEL ? topic : parsed.title);
      const requestedDescription =
        normalizeText(parsed.newCategoryDescription ?? '') ||
        `User-requested research topics related to ${requestedTitle}.`;

      section = addNewSection({
        schema,
        requestedTitle,
        requestedDescription,
      });
    }

    const task = await addTask(deps.repo, {
      title: normalizedTitle,
      description: normalizedDescription,
      category: section.slug,
    });

    section.taskIds.unshift(task.id);
    await writeSchema(deps.repo, schema);

    if (project.status === 'completed') {
      project.status = 'active';
      project.updatedAt = new Date().toISOString();
      await writeProject(deps.repo, project);
    }

    await deps.repo.commitAndPush(`Add backlog task via /add: ${task.title}`);
    console.log(
      `[add] queued task ${contextTag(ctx)} taskId=${task.id} category=${section.slug}`,
    );

    const lines = [`Added to backlog: ${task.title}`];

    if (project.status === 'paused') {
      lines.push('Research is currently paused. Use /resume to process this task.');
    } else {
      lines.push('It will be researched in the next heartbeat cycle.');
    }

    await ctx.reply(lines.join('\n'));
  });
}
