import { generateText, hasToolCall, stepCountIs } from 'ai';
import type { NautilusConfig } from '../config.js';
import { resolveLanguageModel } from '../llm/provider.js';
import type { ResearchTask } from '../types.js';
import { buildResearchTaskPrompt, RESEARCH_SYSTEM_PROMPT } from './prompts.js';
import { createResearchTools, doneToolOutputSchema } from './tools.js';

export interface RunResearchTaskInput {
  config: NautilusConfig;
  projectScope: string;
  task: ResearchTask;
  sectionTitle: string;
  sectionDescription: string;
}

export interface ResearchTaskResult {
  markdown: string;
  sources: Array<{ url: string; title: string }>;
  followUpTopics: string[];
}

function normalizeFollowUpTopics(topics: string[]): string[] {
  const deduped = new Set<string>();
  for (const topic of topics) {
    const normalized = topic.trim().replace(/\s+/g, ' ');
    if (!normalized) continue;
    deduped.add(normalized);
  }
  return Array.from(deduped).slice(0, 8);
}

function extractDonePayload(result: {
  steps: Array<{ toolCalls: Array<{ toolName: string; input: unknown }> }>;
}): unknown {
  for (let stepIndex = result.steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
    const step = result.steps[stepIndex];
    for (let callIndex = step.toolCalls.length - 1; callIndex >= 0; callIndex -= 1) {
      const call = step.toolCalls[callIndex];
      if (call.toolName === 'done') {
        return call.input;
      }
    }
  }

  throw new Error('Research agent did not call done tool before stopping.');
}

export async function runResearchTask(input: RunResearchTaskInput): Promise<ResearchTaskResult> {
  const tools = createResearchTools(input.config);
  const result = await generateText({
    model: resolveLanguageModel(input.config),
    system: RESEARCH_SYSTEM_PROMPT,
    prompt: buildResearchTaskPrompt({
      projectScope: input.projectScope,
      sectionTitle: input.sectionTitle,
      sectionDescription: input.sectionDescription,
      taskTitle: input.task.title,
      taskDescription: input.task.description,
    }),
    tools,
    toolChoice: 'required',
    stopWhen: [hasToolCall('done'), stepCountIs(input.config.maxStepsPerTask)],
  });

  const parsed = doneToolOutputSchema.parse(extractDonePayload(result));
  return {
    markdown: parsed.markdown.trim(),
    sources: parsed.sources,
    followUpTopics: normalizeFollowUpTopics(parsed.followUpTopics),
  };
}
