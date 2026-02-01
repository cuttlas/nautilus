import { query } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "node:readline/promises";

export interface AgentRunOptions {
  prompt: string;
  allowedTools: string[];
}

export interface AgentRunErrorInfo {
  message?: string;
  statusCode?: number;
  requestId?: string;
  errors?: string[];
  retryable?: boolean;
}

export class AgentRunError extends Error {
  info: AgentRunErrorInfo;

  constructor(message: string, info: AgentRunErrorInfo) {
    super(message);
    this.name = "AgentRunError";
    this.info = info;
  }
}

interface AskUserQuestionInput {
  questions?: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

function readTextValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "text" in value) {
    const textValue = (value as { text?: unknown }).text;
    return typeof textValue === "string" ? textValue : null;
  }
  return null;
}

function readTextFromContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => readTextValue(part) ?? readTextFromContent(part))
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join("") : null;
  }
  if (content && typeof content === "object" && "content" in content) {
    return readTextFromContent((content as { content?: unknown }).content);
  }
  return readTextValue(content);
}

function isUserFacingMessage(message: unknown): boolean {
  if (typeof message === "string") {
    return true;
  }
  if (!message || typeof message !== "object") {
    return false;
  }
  const type = (message as { type?: unknown }).type;
  return type === "assistant" || type === "stream_event";
}

function sanitizeOutput(text: string): string {
  return text
    .replace(/User has answered your questions:[^.]*\.\s*/gi, "")
    .replace(/You can now continue with the user's answers in mind\.\s*/gi, "");
}

function extractText(message: unknown): string | null {
  if (typeof message === "string") {
    return message;
  }
  if (!message || typeof message !== "object") {
    return null;
  }
  const record = message as {
    type?: unknown;
    message?: unknown;
    event?: unknown;
    text?: unknown;
    delta?: unknown;
    content?: unknown;
  };

  if (record.type === "assistant") {
    if (record.message && typeof record.message === "object") {
      const content = (record.message as { content?: unknown }).content;
      return readTextFromContent(content);
    }
    return readTextFromContent(record.message);
  }

  if (record.type === "stream_event") {
    const event = record.event;
    if (event && typeof event === "object") {
      const eventRecord = event as {
        delta?: unknown;
        content_block?: unknown;
      };
      return (
        readTextFromContent(eventRecord.delta) ??
        readTextFromContent(eventRecord.content_block) ??
        readTextFromContent(event)
      );
    }
  }

  const directText = readTextValue(record.text);
  if (directText) {
    return directText;
  }

  const deltaText = readTextValue(record.delta);
  if (deltaText) {
    return deltaText;
  }

  return readTextFromContent(record.content);
}

function parseAnswer(
  response: string,
  options: Array<{ label: string }>,
  multiSelect: boolean
): string {
  if (!response) {
    return "";
  }

  const normalized = response
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return response;
  }

  const indices = normalized
    .map((part) => Number(part))
    .filter((value) => Number.isFinite(value));

  if (indices.length === 0) {
    return response;
  }

  const labels = indices
    .map((value) => options[value - 1]?.label)
    .filter((label): label is string => Boolean(label));

  if (labels.length === 0) {
    return response;
  }

  if (!multiSelect && labels.length > 1) {
    return labels[0];
  }

  return multiSelect ? labels.join(", ") : labels[0];
}

async function handleAskUserQuestion(
  input: AskUserQuestionInput
): Promise<PermissionResult> {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  const answers: Record<string, string> = {};

  if (process.stdin.isTTY) {
    let chunk: string | Buffer | null;
    do {
      chunk = process.stdin.read();
    } while (chunk !== null);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    for (const question of questions) {
      const header = question.header ? `${question.header}: ` : "";
      console.log(`\n${header}${question.question}`);

      const options = Array.isArray(question.options)
        ? question.options
        : [];
      if (options.length > 0) {
        options.forEach((option, index) => {
          const description = option.description
            ? ` - ${option.description}`
            : "";
          console.log(`  ${index + 1}. ${option.label}${description}`);
        });
        if (question.multiSelect) {
          console.log(
            "  (Enter numbers separated by commas, or type your own answer)"
          );
        } else {
          console.log("  (Enter a number, or type your own answer)");
        }
      }

      let response = "";
      while (!response) {
        response = (await rl.question("Your choice: ")).trim();
        if (!response && options.length > 0) {
          console.log("Please enter a response (number or text).");
        }
      }
      answers[question.question] = parseAnswer(
        response,
        options,
        Boolean(question.multiSelect)
      );
    }
  } finally {
    rl.close();
  }

  return {
    behavior: "allow",
    updatedInput: {
      questions,
      answers,
    },
  };
}

export async function runAgent(options: AgentRunOptions): Promise<string> {
  const debug = process.env.NAUTILUS_AGENT_DEBUG === "1";
  const maxRetries = Number(process.env.NAUTILUS_AGENT_RETRIES ?? "2");
  const retryDelayMs = Number(process.env.NAUTILUS_AGENT_RETRY_DELAY_MS ?? "1000");

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let finalText = "";
    let sawStreamText = false;
    let emittedAnyOutput = false;
    const errorInfo: AgentRunErrorInfo = {};

    try {
      for await (const message of query({
        prompt: options.prompt,
        options: {
          allowedTools: options.allowedTools,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          includePartialMessages: true,
          canUseTool: async (toolName, input) => {
            if (toolName === "AskUserQuestion") {
              return handleAskUserQuestion(input as AskUserQuestionInput);
            }
            return {
              behavior: "allow",
              updatedInput: input,
            };
          },
        },
      })) {
        if (message && typeof message === "object") {
          const record = message as {
            type?: string;
            errors?: string[];
            subtype?: string;
          };
          if (record.type === "result" && Array.isArray(record.errors)) {
            errorInfo.errors = record.errors;
            if (
              record.errors.some((item) =>
                /server_error|internal server error|api_error|500/i.test(item)
              )
            ) {
              errorInfo.retryable = true;
            }
          }
          if (record.type === "result" && record.subtype?.startsWith("error")) {
            throw new AgentRunError("Agent result error", errorInfo);
          }
          if (!isUserFacingMessage(message)) {
            if (debug) {
              process.stderr.write(
                `[nautilus] Agent event: ${JSON.stringify(message)}\n`
              );
            }
            continue;
          }
        }

        const text = extractText(message);
        if (!text) {
          if (debug) {
            process.stderr.write(
              `[nautilus] Agent event: ${JSON.stringify(message)}\n`
            );
          }
          continue;
        }

        const apiErrorMatch = text.match(
          /API Error:\s*(\d+)[\s\S]*?request_id\"?\s*[:=]\s*\"(req_[a-zA-Z0-9]+)\"/i
        );
        if (apiErrorMatch) {
          const apiStatus = Number(apiErrorMatch[1]);
          const apiRequestId = apiErrorMatch[2];
          throw new AgentRunError(`API Error ${apiStatus}`, {
            statusCode: apiStatus,
            requestId: apiRequestId,
            retryable: apiStatus >= 500,
          });
        }

        const messageType =
          message && typeof message === "object"
            ? (message as { type?: string }).type
            : undefined;

        if (messageType === "assistant" && sawStreamText) {
          continue;
        }

        const sanitized = sanitizeOutput(text);
        if (!sanitized) {
          continue;
        }

        if (messageType === "stream_event") {
          sawStreamText = true;
        }

        finalText += sanitized;
        emittedAnyOutput = true;
        process.stdout.write(sanitized);
      }

      return finalText;
    } catch (error) {
      let detail =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      if (error instanceof AgentRunError) {
        detail = error.message;
        if (!errorInfo.message) {
          errorInfo.message = error.info.message ?? error.message;
        }
        errorInfo.statusCode ??= error.info.statusCode;
        errorInfo.requestId ??= error.info.requestId;
        errorInfo.retryable ??= error.info.retryable;
        errorInfo.errors ??= error.info.errors;
      } else if (!errorInfo.message) {
        errorInfo.message = detail;
      }

      const retryable =
        errorInfo.retryable ||
        /server_error|internal server error|api_error|500/i.test(detail);

      if (retryable && attempt < maxRetries && !emittedAnyOutput) {
        if (!debug) {
          process.stderr.write(
            `[nautilus] Agent error (server). Retrying in ${retryDelayMs}ms...\n`
          );
        } else {
          process.stderr.write(
            `[nautilus] Agent error: ${detail}. Retrying in ${retryDelayMs}ms...\n`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }

      throw new AgentRunError("Agent request failed", errorInfo);
    }
  }

  throw new AgentRunError("Agent request failed", {
    message: "Exceeded retry budget.",
  });
}
