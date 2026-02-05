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

export function loadConfig(): NautilusConfig {
  // TODO: Load from environment variables with validation
  throw new Error('Not implemented');
}
