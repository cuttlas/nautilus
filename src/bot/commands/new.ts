import type { Bot } from 'grammy';
import { analyzeBlindspots, type BlindspotSuggestion } from '../../blindspot/analyzer.js';
import {
  finalizeScoping,
  MAX_SCOPING_QUESTIONS,
  MIN_SCOPING_QUESTIONS,
  runScopingConversation,
} from '../../project/scoping.js';
import { readProject } from '../../project/project.js';
import type { BotDependencies, NautilusBotContext, NautilusConversation } from '../types.js';

export const SCOPING_CONVERSATION = 'scopingConversation';

function contextTag(ctx: NautilusBotContext): string {
  const chatId = ctx.chat?.id ?? 'unknown';
  const userId = ctx.from?.id ?? 'unknown';
  return `chat=${chatId} user=${userId}`;
}

function parseTopic(text: string): string {
  return text.replace(/^\/new(@\w+)?/i, '').trim();
}

function formatProjectSummary(input: {
  title: string;
  slug: string;
}): string {
  return [
    `Project initialized: ${input.title}`,
    `Slug: ${input.slug}`,
    '',
    'Use /add <topic> to start adding research tasks.',
    'Research will begin on the next heartbeat after tasks are added.',
  ].join('\n');
}

function formatBlindspotSuggestions(suggestions: BlindspotSuggestion[]): string {
  const lines = [`Here are some initial topic suggestions (${suggestions.length}):`];

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];
    lines.push('');
    lines.push(`${i + 1}. ${s.title}`);
    lines.push(`   ${s.rationale}`);
  }

  lines.push('');
  lines.push('Use /add <topic> to research any of these.');
  return lines.join('\n');
}

function formatErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    'I hit an error while finalizing your project after scoping.',
    `Error: ${detail}`,
    'Please check your data repo setup and try /new again.',
  ].join('\n');
}

export function createScopingConversation(deps: BotDependencies) {
  return async function scopingConversation(
    conversation: NautilusConversation,
    ctx: NautilusBotContext,
    topic: string,
  ): Promise<void> {
    console.log(`[new] scoping started ${contextTag(ctx)} topic="${topic}"`);

    const history: Array<{ role: 'assistant' | 'user'; content: string }> = [
      { role: 'user', content: topic },
    ];

    await ctx.reply(
      [
        `Starting a new project for: "${topic}"`,
        'I will ask a few scoping questions, one at a time.',
        'Send /cancel to stop.',
      ].join('\n'),
    );

    let askedQuestions = 0;
    let completed = false;

    while (askedQuestions < MAX_SCOPING_QUESTIONS) {
      const turn = await conversation.external(() =>
        runScopingConversation({
          config: deps.config,
          topic,
          history,
          askedQuestions,
        }),
      );

      history.push({ role: 'assistant', content: turn.assistantMessage });
      await ctx.reply(turn.assistantMessage);
      console.log(
        `[new] scoping turn ${contextTag(ctx)} asked=${askedQuestions} isComplete=${turn.isComplete}`,
      );

      // `askedQuestions` counts completed user replies. On the 5th scoping turn,
      // this value is 4, so we allow completion at min-1.
      if (turn.isComplete && askedQuestions >= MIN_SCOPING_QUESTIONS - 1) {
        completed = true;
        break;
      }

      const nextCtx = await conversation.waitFor(':text', {
        otherwise: async (invalidCtx) => {
          await invalidCtx.reply('Please reply with text so I can continue scoping.');
        },
      });

      const answer = nextCtx.msg.text.trim();
      if (/^\/cancel\b/i.test(answer)) {
        console.log(`[new] scoping cancelled ${contextTag(nextCtx)}`);
        await nextCtx.reply('Scoping cancelled. No project files were changed.');
        return;
      }

      history.push({ role: 'user', content: answer });
      askedQuestions += 1;
      ctx = nextCtx;
    }

    if (!completed) {
      await ctx.reply('I have enough context to generate your initial project files.');
    }

    console.log(`[new] finalizing project ${contextTag(ctx)} topic="${topic}"`);
    let finalized: Awaited<ReturnType<typeof finalizeScoping>>;
    try {
      finalized = await conversation.external(async () => {
        const result = await finalizeScoping(deps.repo, deps.config, {
          topic,
          history,
        });

        await deps.repo.commitAndPush(`Initialize project from /new: ${result.project.slug}`);
        return result;
      });
      console.log(
        `[new] finalized project ${contextTag(ctx)} slug=${finalized.project.slug}`,
      );
    } catch (error) {
      console.error('Failed to finalize /new project:', error);
      await ctx.reply(formatErrorMessage(error));
      return;
    }

    await ctx.reply(
      formatProjectSummary({
        title: finalized.project.title,
        slug: finalized.project.slug,
      }),
    );

    try {
      const suggestions = await conversation.external(() =>
        analyzeBlindspots({ config: deps.config, repo: deps.repo }),
      );
      if (suggestions.length > 0) {
        await ctx.reply(formatBlindspotSuggestions(suggestions));
      }
    } catch (error) {
      console.error('[new] post-creation blindspot analysis failed:', error);
    }
  };
}

export function registerNewCommand(bot: Bot<NautilusBotContext>, deps: BotDependencies): void {
  bot.command('new', async (ctx) => {
    const topic = parseTopic(ctx.message?.text ?? '');
    if (!topic) {
      console.log(`[new] missing topic ${contextTag(ctx)}`);
      await ctx.reply('Usage: /new <research topic>');
      return;
    }

    console.log(`[new] /new received ${contextTag(ctx)} topic="${topic}"`);
    const currentProject = await readProject(deps.repo);
    if (currentProject && ['scoping', 'active', 'paused'].includes(currentProject.status)) {
      console.log(
        `[new] blocked existing project ${contextTag(ctx)} status=${currentProject.status} title="${currentProject.title}"`,
      );
      await ctx.reply(
        [
          `A project is already ${currentProject.status}: ${currentProject.title}`,
          'Complete it or archive it before creating a new one.',
        ].join('\n'),
      );
      return;
    }

    console.log(`[new] entering scoping conversation ${contextTag(ctx)}`);
    await ctx.conversation.enter(SCOPING_CONVERSATION, topic);
  });
}
