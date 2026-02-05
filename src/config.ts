import { z } from 'zod';

export interface NautilusConfig {
  telegramBotToken: string;
  telegramChatId: string;
  anthropicApiKey: string;
  tavilyApiKey: string;
  githubToken: string;
  dataRepoUrl: string;
  defaultModel: string;
  heartbeatIntervalMinutes: number;
  maxStepsPerTask: number;
  siteUrl: string;
}

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  TAVILY_API_KEY: z.string().min(1),
  GITHUB_TOKEN: z.string().min(1),
  DATA_REPO_URL: z.string().min(1),
  SITE_URL: z.string().url(),
  DEFAULT_MODEL: z.string().default('claude-sonnet-4-5-20250929'),
  HEARTBEAT_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  MAX_STEPS_PER_TASK: z.coerce.number().int().positive().default(25),
});

let _config: NautilusConfig | null = null;

export function loadConfig(): NautilusConfig {
  if (_config) return _config;

  const parsed = configSchema.parse(process.env);

  _config = {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramChatId: parsed.TELEGRAM_CHAT_ID,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
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
