import { tavily } from '@tavily/core';
import { tool } from 'ai';
import { z } from 'zod';
import type { NautilusConfig } from '../config.js';

export const doneToolOutputSchema = z.object({
  markdown: z.string().min(100),
  sources: z
    .array(
      z.object({
        url: z.string().url(),
        title: z.string().min(1),
      }),
    )
    .min(1),
  followUpTopics: z.array(z.string().min(3)).default([]),
});

export function createResearchTools(config: NautilusConfig) {
  const client = tavily({ apiKey: config.tavilyApiKey });

  return {
    webSearch: tool({
      description:
        'Search the web for relevant sources. Use this first to identify promising links.',
      inputSchema: z.object({
        query: z.string().min(3).describe('Specific search query with context.'),
      }),
      execute: async ({ query }) => {
        const response = await client.search(query, {
          searchDepth: 'advanced',
          maxResults: 5,
          includeAnswer: true,
        });

        return {
          query: response.query,
          answer: response.answer ?? null,
          results: response.results.map((result) => ({
            title: result.title,
            url: result.url,
            content: result.content,
            publishedDate: result.publishedDate,
            score: result.score,
          })),
        };
      },
    }),

    webFetch: tool({
      description:
        'Fetch and read the content of a specific URL for deep verification and details.',
      inputSchema: z.object({
        url: z.string().url(),
      }),
      execute: async ({ url }) => {
        const response = await client.extract([url], { extractDepth: 'advanced' });
        const extracted = response.results[0];
        const failed = response.failedResults[0];

        if (!extracted) {
          throw new Error(failed ? `Failed to extract ${url}: ${failed.error}` : `Failed to extract ${url}`);
        }

        return {
          url: extracted.url,
          rawContent: extracted.rawContent.slice(0, 40_000),
        };
      },
    }),

    done: tool({
      description:
        'Signal that research is complete. Provide final markdown, sources, and optional follow-up topics.',
      inputSchema: doneToolOutputSchema,
      execute: async (input) => input,
    }),
  };
}
