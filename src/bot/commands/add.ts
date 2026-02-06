import { generateObject } from 'ai';
import type { Bot } from 'grammy';
import { z } from 'zod';
import { resolveLanguageModel } from '../../llm/provider.js';
import { addTask } from '../../project/backlog.js';
import { readProject, writeProject } from '../../project/project.js';
import { readSchema, writeSchema } from '../../project/schema.js';
import type { DocumentSchema, SchemaSection, SchemaSubsection } from '../../types.js';
import type { BotDependencies, NautilusBotContext } from '../types.js';

const NEW_CATEGORY_SENTINEL = '__new__';
const DEFAULT_SUBSECTION_TITLE = 'General';
const DEFAULT_SUBSECTION_SLUG = 'general';

const addTopicSchema = z.object({
  title: z.string().min(5),
  description: z.string().min(20),
  categorySlug: z.string().min(1),
  subsectionSlug: z.string().min(1).optional(),
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
      subsections: section.subsections.map((subsection) => ({
        slug: subsection.slug,
        title: subsection.title,
      })),
    })),
    null,
    2,
  );
}

async function parseAddTopicWithLlm(input: {
  deps: BotDependencies;
  topic: string;
  schema: DocumentSchema;
}): Promise<ParsedAddTopic> {
  const { object } = await generateObject({
    model: resolveLanguageModel(input.deps.config),
    schema: addTopicSchema,
    system: [
      'You map a user /add topic into a structured research task for Nautilus.',
      `If no existing category fits, set categorySlug to "${NEW_CATEGORY_SENTINEL}" and provide newCategoryTitle/newCategoryDescription.`,
      `Only choose subsectionSlug values that exist inside the chosen category. If unknown, omit subsectionSlug.`,
      'Task title must be concise and specific.',
      'Task description must be actionable and narrow enough for one research cycle.',
      'Return only valid structured output.',
    ].join('\n'),
    prompt: [
      'User /add input:',
      input.topic,
      '',
      'Existing schema categories and subsections (JSON):',
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

function ensureExistingTarget(input: {
  schema: DocumentSchema;
  categorySlug: string;
  subsectionSlug?: string;
}): { section: SchemaSection; subsection: SchemaSubsection } | null {
  const section = findSectionByLooseSlug(input.schema, input.categorySlug);
  if (!section) {
    return null;
  }

  if (section.subsections.length === 0) {
    section.subsections.push({
      slug: DEFAULT_SUBSECTION_SLUG,
      title: DEFAULT_SUBSECTION_TITLE,
      taskIds: [],
    });
    return {
      section,
      subsection: section.subsections[0],
    };
  }

  if (!input.subsectionSlug) {
    return {
      section,
      subsection: section.subsections[0],
    };
  }

  const normalizedSubsectionSlug = slugify(input.subsectionSlug);
  const subsection =
    section.subsections.find(
      (entry) =>
        entry.slug === normalizedSubsectionSlug ||
        slugify(entry.title) === normalizedSubsectionSlug,
    ) ?? section.subsections[0];

  return {
    section,
    subsection,
  };
}

function addNewCategorySection(input: {
  schema: DocumentSchema;
  requestedTitle: string;
  requestedDescription: string;
  subsectionTitle?: string;
}): { section: SchemaSection; subsection: SchemaSubsection } {
  const sectionSlugSet = new Set(input.schema.sections.map((section) => section.slug));
  const subsectionSlugSet = new Set(
    input.schema.sections.flatMap((section) => section.subsections.map((subsection) => subsection.slug)),
  );
  const sectionOrder = input.schema.sections.reduce((maxOrder, section) => Math.max(maxOrder, section.order), -1) + 1;

  const subsectionTitle = normalizeText(input.subsectionTitle ?? DEFAULT_SUBSECTION_TITLE) || DEFAULT_SUBSECTION_TITLE;
  const subsection: SchemaSubsection = {
    slug: uniqueSlug(subsectionTitle, subsectionSlugSet, DEFAULT_SUBSECTION_SLUG),
    title: subsectionTitle,
    taskIds: [],
  };

  const section: SchemaSection = {
    slug: uniqueSlug(input.requestedTitle, sectionSlugSet, 'new-category'),
    title: normalizeText(input.requestedTitle) || 'Additional Topics',
    description: normalizeText(input.requestedDescription) || 'Additional ad hoc user-requested research topics.',
    order: sectionOrder,
    subsections: [subsection],
  };

  input.schema.sections.push(section);
  input.schema.sections.sort((a, b) => a.order - b.order);
  return { section, subsection };
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
      });
    } catch (error) {
      console.error('[add] failed to parse /add input:', error);
      await ctx.reply('I could not parse that topic into a task. Please try a more specific /add request.');
      return;
    }

    const normalizedTitle = normalizeText(parsed.title);
    const normalizedDescription = normalizeText(parsed.description);

    let target = ensureExistingTarget({
      schema,
      categorySlug: parsed.categorySlug,
      subsectionSlug: parsed.subsectionSlug,
    });

    let createdCategory = false;
    if (!target || parsed.categorySlug === NEW_CATEGORY_SENTINEL) {
      const requestedTitle =
        normalizeText(parsed.newCategoryTitle ?? '') ||
        normalizeText(parsed.categorySlug === NEW_CATEGORY_SENTINEL ? topic : parsed.title);
      const requestedDescription =
        normalizeText(parsed.newCategoryDescription ?? '') ||
        `User-requested research topics related to ${requestedTitle}.`;

      target = addNewCategorySection({
        schema,
        requestedTitle,
        requestedDescription,
      });
      createdCategory = true;
    }

    if (!target) {
      console.error('[add] no category target after /add parsing');
      await ctx.reply('I could not map that topic to a category. Please try /add again.');
      return;
    }

    const task = await addTask(deps.repo, {
      title: normalizedTitle,
      description: normalizedDescription,
      category: target.section.slug,
    });

    target.subsection.taskIds.unshift(task.id);
    await writeSchema(deps.repo, schema);

    let reactivatedProject = false;
    if (project.status === 'completed') {
      project.status = 'active';
      project.updatedAt = new Date().toISOString();
      await writeProject(deps.repo, project);
      reactivatedProject = true;
    }

    await deps.repo.commitAndPush(`Add backlog task via /add: ${task.title}`);
    console.log(
      `[add] queued task ${contextTag(ctx)} taskId=${task.id} category=${target.section.slug} subsection=${target.subsection.slug}`,
    );

    const lines = [`Added to backlog: ${task.title}`];
    if (createdCategory) {
      lines.push(`New category created: "${target.section.title}"`);
    }

    if (reactivatedProject) {
      lines.push('Research was marked completed before; the project has been reactivated.');
    }

    if (project.status === 'paused') {
      lines.push('Research is currently paused. Use /resume to process this task.');
    } else {
      lines.push('It will be researched in the next heartbeat cycle.');
    }

    await ctx.reply(lines.join('\n'));
  });
}
