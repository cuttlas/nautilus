export const RESEARCH_SYSTEM_PROMPT =
  [
    'You are Nautilus, a deep research assistant.',
    'Research carefully, cross-check claims, and prioritize actionable facts.',
    'Prefer primary sources for important claims and cite source URLs.',
  ].join('\n');

export const SCOPING_SYSTEM_PROMPT =
  [
    'You are Nautilus, a Telegram scoping assistant.',
    'Ask one concise question at a time to clarify project scope.',
    'Be conversational, practical, and avoid bureaucratic phrasing.',
    'You must return valid structured output only.',
    'After enough context is collected, set isComplete=true and provide a brief transition message.',
  ].join('\n');

export const SCOPING_PLAN_SYSTEM_PROMPT =
  [
    'You design a project bootstrap package for Nautilus.',
    'Return only valid structured output that matches the schema exactly.',
    'Do not include markdown, prose wrappers, or keys that are not in schema.',
    'Use specific, actionable language and realistic section structure.',
  ].join('\n');

export const SCOPING_TASKS_SYSTEM_PROMPT =
  [
    'You create the initial backlog tasks for a Nautilus project.',
    'Return only valid structured output that matches the schema exactly.',
    'Each task must be specific, practical, and completable in one research cycle.',
    'Each task must reference an existing schema slug exactly.',
  ].join('\n');

export function buildScopingTurnPrompt(input: {
  topic: string;
  askedQuestions: number;
  minQuestions: number;
  maxQuestions: number;
  conversation: string;
}): string {
  return [
    `Topic: ${input.topic}`,
    `Questions asked so far: ${input.askedQuestions}`,
    `Do not mark complete before ${input.minQuestions} questions.`,
    `Must mark complete no later than ${input.maxQuestions} questions.`,
    '',
    'Return an object with these keys only:',
    '- assistantMessage: one short question or completion transition sentence.',
    '- isComplete: boolean.',
    '',
    'Conversation:',
    input.conversation,
  ].join('\n');
}

export function buildScopingPlanPrompt(input: {
  topic: string;
  conversation: string;
  minSections: number;
  maxSections: number;
}): string {
  return [
    'Create the initial project package for Nautilus.',
    'Hard constraints:',
    '- Follow the schema exactly. Do not omit required keys.',
    '- Do not output markdown or extra commentary.',
    `- Create between ${input.minSections} and ${input.maxSections} sections.`,
    '- Each section must contain at least one subsection.',
    '- Slugs must be lowercase kebab-case and concise.',
    '- Descriptions must be concrete and practical.',
    '',
    `Topic: ${input.topic}`,
    '',
    'Conversation transcript:',
    input.conversation,
  ].join('\n');
}

export function buildScopingTasksPrompt(input: {
  topic: string;
  projectTitle: string;
  projectScope: string;
  schemaSummaryJson: string;
  targetTasks: number;
  minTasks: number;
  maxTasks: number;
}): string {
  return [
    'Create the initial backlog tasks for this project.',
    'Hard constraints:',
    '- Follow the schema exactly. Do not omit required keys.',
    '- Do not output markdown or extra commentary.',
    `- Return around ${input.targetTasks} tasks (between ${input.minTasks} and ${input.maxTasks}).`,
    '- Use categorySlug and subsectionSlug values exactly from the provided schema list.',
    '- Do not invent new slugs.',
    '- Avoid duplicate or overlapping tasks.',
    '- Each task should be narrow enough for one research cycle.',
    '',
    `Project topic: ${input.topic}`,
    `Project title: ${input.projectTitle}`,
    `Project scope: ${input.projectScope}`,
    '',
    'Allowed categories and subsections (JSON):',
    input.schemaSummaryJson,
  ].join('\n');
}

export function buildScopingRetryPrompt(input: {
  retryLabel: string;
  validationError: string;
  previousPrompt: string;
}): string {
  return [
    `Previous ${input.retryLabel} output failed schema validation.`,
    'Regenerate from scratch and strictly follow the required schema.',
    'Return only the object, with all required keys and valid types.',
    'Do not include markdown, explanations, or code fences.',
    '',
    'Validation error summary:',
    input.validationError,
    '',
    'Original task prompt:',
    input.previousPrompt,
  ].join('\n');
}
