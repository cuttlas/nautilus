import { z } from 'zod';

export interface NautilusConfig {
  telegramBotToken: string;
  telegramChatId: string;
  anthropicApiKey?: string;
  googleGenerativeAiApiKey?: string;
  tavilyApiKey: string;
  githubToken: string;
  dataRepoUrl: string;
  defaultModel: string;
  heartbeatIntervalMinutes: number;
  maxStepsPerTask: number;
  siteUrl: string;
}

const configSchema = z
  .object({
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    TELEGRAM_CHAT_ID: z.string().min(1),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
    TAVILY_API_KEY: z.string().min(1),
    GITHUB_TOKEN: z.string().min(1),
    DATA_REPO_URL: z.string().min(1),
    SITE_URL: z.string().url(),
    DEFAULT_MODEL: z.string().default('gemini-2.5-flash'),
    HEARTBEAT_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
    MAX_STEPS_PER_TASK: z.coerce.number().int().positive().default(25),
  })
  .superRefine((value, ctx) => {
    const model = value.DEFAULT_MODEL.trim().toLowerCase();
    if (model.startsWith('claude-') && !value.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_API_KEY'],
        message: 'ANTHROPIC_API_KEY is required when DEFAULT_MODEL is a Claude model.',
      });
    }

    if ((model.startsWith('gemini-') || model.startsWith('gemma-')) && !value.GOOGLE_GENERATIVE_AI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_GENERATIVE_AI_API_KEY'],
        message:
          'GOOGLE_GENERATIVE_AI_API_KEY is required when DEFAULT_MODEL is a Gemini/Gemma model.',
      });
    }
  });

let _config: NautilusConfig | null = null;

export function loadConfig(): NautilusConfig {
  if (_config) return _config;

  const parsed = configSchema.parse(process.env);

  _config = {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramChatId: parsed.TELEGRAM_CHAT_ID,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
    googleGenerativeAiApiKey: parsed.GOOGLE_GENERATIVE_AI_API_KEY,
    tavilyApiKey: parsed.TAVILY_API_KEY,
    githubToken: parsed.GITHUB_TOKEN,
    dataRepoUrl: parsed.DATA_REPO_URL,
    defaultModel: parsed.DEFAULT_MODEL,
    heartbeatIntervalMinutes: parsed.HEARTBEAT_INTERVAL_MINUTES,
    maxStepsPerTask: parsed.MAX_STEPS_PER_TASK,
    siteUrl: parsed.SITE_URL,
  };

  return _config;
}
