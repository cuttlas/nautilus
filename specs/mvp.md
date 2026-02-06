# Nautilus MVP Specification

## Overview

Nautilus is a Telegram-controlled AI research tool that autonomously builds comprehensive static websites from deep web research. Users define a research topic, and Nautilus continuously researches, writes, and publishes content on a heartbeat — no manual prompting required.

### Motivation

Preparing for a complex life event (e.g., digital nomading in SE Asia) requires researching dozens of interconnected topics: visas, flights, healthcare, insurance, accommodation, scams, internet, language, and more. This research is overwhelming, fragmented across sources, and constantly evolving. Nautilus solves this by letting AI do the deep research autonomously while the user controls it from their phone via Telegram.

### MVP Scope

The MVP delivers the core research loop: create a project, generate a backlog, research tasks on a heartbeat, and publish results as a static website. Everything is controlled via Telegram.

---

## Architecture

```
┌──────────┐  Telegram   ┌──────────────┐  git push   ┌───────────────────────┐
│   User   │◄───────────►│   Nautilus    │────────────►│  Project Data Repo    │
│ (phone)  │   Bot API   │   (Railway)   │             │  (GitHub)             │
└──────────┘             └──┬──────┬────┘             │  state + content +    │
                            │      │                   │  Astro site source    │
                   Anthropic API  Tavily API           └──────────┬────────────┘
                    (Claude)      (Web Search)                    │
                                                        git push triggers
                                                                  │
                                                         ┌────────▼────────┐
                                                         │  Cloudflare     │
                                                         │  Pages (Astro)  │
                                                         └─────────────────┘
```

### Repository Strategy

Nautilus uses **two repos**:

1. **`nautilus`** — Application source code (bot, heartbeat, agent). Deployed to Railway.
2. **One data repo per project** — e.g., `sea-nomad`, `learn-rust`. Each contains project state, content, and an Astro site. Each is connected to its own Cloudflare Pages deployment.

This means each project gets its own independent site (e.g., `sea-nomad.pages.dev`). In the MVP, only one project is supported, so there's one data repo. Multi-project support (future extension) simply means managing multiple data repos.

### Tech Stack

| Component | Technology | Reason |
|---|---|---|
| Runtime | Node.js + TypeScript | Type safety, async-friendly |
| AI | Vercel AI SDK + `@ai-sdk/anthropic` | Provider-agnostic, `generateObject`, `ToolLoopAgent` |
| LLM | Claude Sonnet 4.5 | Best balance of quality, speed, and cost for research |
| Web Search | Tavily API | Built for AI agents, returns clean structured content |
| Telegram Bot | grammy | Modern, TypeScript-first, well-maintained |
| Static Site | Astro | Fast, content-focused, markdown-native |
| State | JSON files in git | Simple, versionable, inspectable |
| Hosting (service) | Railway | Zero-maintenance, git-push deploys |
| Hosting (site) | Cloudflare Pages | Free, fast global CDN, auto-deploys from GitHub |

---

## Data Model

### Directory Structure

Each project has its own GitHub repository with this flat structure:

```
{project-slug}/                       # GitHub repository (e.g., "sea-nomad")
├── project.json                      # Project scope & metadata
├── backlog.json                      # Research task queue
├── schema.json                       # Document structure / outline
├── content/                          # Researched markdown files
│   ├── {category}/
│   │   ├── {topic}.md
│   │   └── ...
│   └── ...
└── site/                             # Astro source
    ├── astro.config.mjs
    ├── package.json
    ├── src/
    │   ├── layouts/
    │   │   └── ResearchLayout.astro
    │   ├── pages/
    │   │   ├── index.astro           # Auto-generated from schema
    │   │   └── [...slug].astro       # Dynamic routing from content/
    │   └── components/
    │       ├── TableOfContents.astro
    │       ├── SourceList.astro
    │       └── LastUpdated.astro
    └── public/
```

The Nautilus service (separate repo) knows how to clone, read, write, and push to this repo:

```
nautilus/                              # Application source code repo
├── src/
│   └── ...                           # Bot, heartbeat, agent code
├── package.json
└── .env                              # Includes DATA_REPO_URL for the active project
```

### Project Config (`project.json`)

```typescript
interface Project {
  id: string;                         // UUID
  slug: string;                       // URL-safe name, e.g., "sea-nomad"
  title: string;                      // "Digital Nomading in SE Asia"
  scope: string;                      // Full scope description (from scoping conversation)
  status: 'scoping' | 'active' | 'paused' | 'completed';
  heartbeatIntervalMinutes: number;   // Default: 30
  model: string;                      // Default: "claude-sonnet-4-5-20250929"
  createdAt: string;                  // ISO date
  updatedAt: string;                  // ISO date
  siteUrl: string;                    // Cloudflare Pages URL
}
```

### Backlog (`backlog.json`)

```typescript
interface Backlog {
  tasks: ResearchTask[];
}

interface ResearchTask {
  id: string;                         // UUID
  title: string;                      // "Thailand tourist visa requirements for EU citizens"
  description: string;                // Detailed research instructions for the AI
  category: string;                   // Maps to document section, e.g., "visas"
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  outputPath?: string;                // Relative path to generated content file
}
```

Tasks are processed in FIFO order. User-added tasks (via `/add`) are inserted at the front of the queue so they are researched next.

### Document Schema (`schema.json`)

```typescript
interface DocumentSchema {
  title: string;
  description: string;
  sections: SchemaSection[];
}

interface SchemaSection {
  slug: string;                       // "visas"
  title: string;                      // "Visas & Immigration"
  description: string;                // What this section covers
  order: number;                      // Display order
  taskIds: string[];                  // Links to backlog tasks
}
```

### Content Files (`content/{category}/{topic}.md`)

```markdown
---
title: "Thailand Tourist Visa Requirements"
category: "visas"
sources:
  - url: "https://example.com/thailand-visa"
    title: "Official Thai Immigration"
  - url: "https://example.com/visa-guide"
    title: "Nomad Visa Guide"
researchedAt: "2026-02-05T14:30:00Z"
---

# Thailand Tourist Visa Requirements

Content goes here...
```

---

## Flows

### Flow 1: Project Creation (Scoping)

**Trigger**: User sends `/new Digital nomading in SE Asia for 3 months` on Telegram.

**Steps:**

1. Bot checks if an active/paused/scoping project already exists. If so, asks user to complete or archive it first.
2. Bot enters a scoping conversation. It uses `generateObject` with a structured schema to ask questions one at a time and understand the research scope. Key areas to probe:
   - Personal context (nationality, budget, timeline, work situation)
   - Geographic scope (which countries/cities)
   - Priority topics (what matters most)
   - Existing knowledge (what they already know, to avoid redundancy)
3. Each user reply is sent back to the LLM (maintaining conversation history). The LLM signals it has enough information via a `isComplete: true` field in its structured output.
4. Once scoping is complete, use `generateObject` to produce:
   - A project `title`
   - A comprehensive `scope` description
5. Bot creates the project scaffolding:
   - Empty `backlog.json` (`{ tasks: [] }`)
   - Empty `schema.json` (`{ title, description: scope, sections: [] }`)
   - `project.json` with status `active`
   - Astro site boilerplate in `site/` directory
6. State is committed and pushed to git (triggers Cloudflare Pages build).
7. Bot sends a project summary to Telegram: title, slug, and instructions to use `/add`.
8. Bot runs a blindspot analysis and sends initial topic suggestions to help the user get started with `/add`.

**Design rationale**: `/new` only creates scope — no sections, no tasks. Sections and tasks are created incrementally via `/add` and informed by blindspot analysis. This gives the user full control over what gets researched.

**Scoping System Prompt Guidelines:**
- Ask one question at a time (Telegram is a chat interface, not a form)
- Be conversational, not bureaucratic
- Infer what you can (e.g., if they say "EU passport", infer Schengen rules apply)
- After 5-10 questions, check if the user wants to add anything else
- Focus on producing a thorough scope description — this scope is used by blindspot analysis and `/add` to make smart decisions

### Flow 2: Research Heartbeat

**Trigger**: Timer fires every `heartbeatIntervalMinutes` (default: 30 minutes).

**Steps:**

1. Check project status. Skip if `paused` or `completed`.
2. Check if a task is already `in_progress`. If so, skip this heartbeat (previous research is still running).
3. Pick the next `queued` task (FIFO — first in, first out).
3. If no queued tasks remain:
   - If the backlog is completely empty (no tasks at all), skip — the project is waiting for `/add`.
   - If the backlog has tasks but none are queued, set project status to `completed` and notify user.
4. Mark task as `in_progress`.
5. Build the research prompt:
   - Include the project scope for context
   - Include the task title and description
   - Include the document schema section this task belongs to
   - Instruct Claude on output format (markdown with frontmatter)
6. Run `ToolLoopAgent` with:
   - `webSearch` tool (via Tavily)
   - `webFetch` tool (for reading specific pages found via search)
   - `done` tool (to signal completion and return structured output)
   - Max 25 steps
7. Extract the `done` tool call output:
   - `markdown`: the researched content
   - `sources`: URLs used
   - `followUpTopics`: optional new topics discovered during research
8. Write the markdown content file to `content/{category}/{topic}.md`.
9. Mark task as `completed`, record `outputPath` and `completedAt`.
10. Commit all changes and push to git (triggers Astro site rebuild).
11. Send Telegram notification: task title + link to the page on the site.
12. If `followUpTopics` were suggested, include them in the Telegram notification so the user can manually `/add` them if interested.

**Research System Prompt Guidelines:**
- Search broadly first (2-3 general queries), then dive deep into specific sources
- Cross-reference multiple sources; flag contradictions
- Prioritize practical, actionable information (costs, addresses, timelines, links)
- Include "last verified" notes for time-sensitive info (e.g., visa fees, entry rules)
- Write in clear, scannable format: headers, bullet points, tables where appropriate
- Always include source URLs for key claims
- Target 500-2000 words per topic (not too shallow, not a novel)

**Error Handling:**
- If the agent fails (API error, timeout, etc.), mark the task as `failed` and notify user on Telegram.
- No automatic retries. The user can manually re-add the topic via `/add` if needed.

**Git Operations:**
- All git operations (commit + push) go through a serial queue to prevent conflicts between the heartbeat and user commands (e.g., `/add` triggering a push while research is also pushing).
- Always pull before pushing to incorporate any changes.

### Flow 3: Adding Topics via Telegram

**Trigger**: User sends `/add SIM cards and local phone numbers in SE Asia`

**Steps:**

1. Use `generateObject` to parse the user's free-text input into a structured `ResearchTask`:
   - The LLM receives the project scope and existing schema sections as context.
   - It maps the topic to an existing section if one fits, or signals that a new section should be created (via a `__new__` sentinel slug with title and description).
   - It generates a concise `title` and actionable `description` for the AI researcher.
2. Resolve the target section:
   - If the LLM matched an existing slug, find the section (using loose slug matching — matches by slug or slugified title).
   - If no match is found or the LLM requested a new section, create a new `SchemaSection` with an auto-generated slug, the requested title/description, and an empty `taskIds` array.
3. Add the task to the **front** of the backlog (so it's researched next).
4. Add the task ID to the section's `taskIds` array and write the updated schema.
5. If the project was `completed`, reactivate it to `active` status.
6. Commit and push.
7. Confirm to user on Telegram:

```
Added to backlog: SIM cards and local phone numbers in SE Asia
It will be researched in the next heartbeat cycle.
```

If the project is paused, the reply notes that `/resume` is needed.

### Flow 4: Blindspot Analysis

**Triggers:**
- Automatically after `/new` creates a project (immediate suggestions to help user start adding tasks).
- On-demand via `/blindspot` command.
- Periodically via a blindspot heartbeat timer (configurable interval, independent from the research heartbeat).

**Steps:**

1. Read `project.json`, `schema.json`, and `backlog.json`.
2. Build a context prompt including: project scope, existing schema sections, completed task titles, and queued task titles.
3. Use `generateObject` to ask the LLM for blindspot suggestions — topics that are missing or under-covered given the project scope.
4. Each suggestion includes a `title` and `rationale` explaining why it's a gap.
5. Send suggestions to Telegram with instructions to use `/add` for any that interest the user.

**Guidelines for the blindspot LLM:**
- Focus on practical day-to-day concerns a first-timer wouldn't know to ask about
- Identify cross-cutting concerns that span multiple categories
- Highlight recent developments or changes (2025-2026)
- Surface edge cases and common gotchas
- Do not suggest topics already covered by completed or queued tasks
- Each suggestion must be specific enough for one research cycle

---

## Telegram Bot

### Framework

Use [grammy](https://grammy.dev/) — a modern, TypeScript-first Telegram bot framework.

### Commands

| Command | Description | Response |
|---|---|---|
| `/new <topic>` | Start a new research project | Begins scoping conversation, creates scope-only project |
| `/add <topic>` | Add a research topic to backlog | Creates task + section if needed, confirms added |
| `/status` | Show project status | Tasks completed/total, next task, last activity |
| `/site` | Get link to the generated website | Sends the Cloudflare Pages URL |
| `/pause` | Pause the research heartbeat | Confirms paused |
| `/resume` | Resume the research heartbeat | Confirms resumed, shows next task |
| `/backlog` | Show pending tasks summary | Lists queued tasks grouped by category |
| `/blindspot` | Run blindspot analysis | Suggests under-researched topics based on scope and coverage |
| `/help` | Show available commands | Lists commands with descriptions |

### Conversation State

The bot needs to track conversation state for the scoping flow (multi-turn). Use grammy's [conversations plugin](https://grammy.dev/plugins/conversations) to manage this. Outside of scoping, the bot is stateless — each command is independent.

### Notifications (Bot → User)

The bot proactively sends messages when:
- A research task is completed (with link to new page)
- A research task fails
- All tasks are completed (project done)
- The heartbeat is paused/resumed

**Task completion notification format:**

```
✅ Completed: Thailand Tourist Visa Requirements
🔗 https://sea-nomad.pages.dev/visas/thailand

💡 Follow-up topics discovered:
  - Thailand Elite Visa (long-term option)
  - Visa run logistics from Bangkok
  - Thai immigration recent rule changes 2025-2026

Use /add <topic> to research any of these.
```

Follow-up topics are suggestions from the research agent — topics it encountered during research that aren't in the backlog yet. They're shown inline so the user can decide whether to `/add` them. They are not auto-added to the backlog.

---

## Research Agent

### Tools

```typescript
const tools = {
  webSearch: tool({
    description: 'Search the web for information on a topic. Returns a list of relevant results with titles, URLs, and content snippets.',
    inputSchema: z.object({
      query: z.string().describe('The search query. Be specific and include relevant context.'),
    }),
    execute: async ({ query }) => {
      const results = await tavily.search(query, {
        searchDepth: 'advanced',
        maxResults: 5,
        includeAnswer: true,
      });
      return results;
    },
  }),

  webFetch: tool({
    description: 'Fetch and read the full content of a specific web page. Use this after webSearch to get detailed information from a promising result.',
    inputSchema: z.object({
      url: z.string().url().describe('The URL to fetch'),
    }),
    execute: async ({ url }) => {
      // Use a readability-style parser to extract main content
      return extractPageContent(url);
    },
  }),

  done: tool({
    description: 'Signal that research is complete and provide the final output.',
    inputSchema: z.object({
      markdown: z.string().describe('The fully researched content as markdown'),
      sources: z.array(z.object({
        url: z.string(),
        title: z.string(),
      })).describe('All sources referenced'),
      followUpTopics: z.array(z.string())
        .describe('Suggested follow-up topics discovered during research'),
    }),
    // No execute — stops the agent loop
  }),
};
```

### Agent Configuration

```typescript
const researchAgent = new ToolLoopAgent({
  model: anthropic('claude-sonnet-4-5-20250929'),
  system: RESEARCH_SYSTEM_PROMPT,
  tools,
  toolChoice: 'required',
  stopWhen: stepCountIs(25),
});
```

---

## Static Site (Astro)

### Generation Strategy

The Astro site is a standard project living inside the git repo (`site/` directory). Content pages are generated from the markdown files in `content/`. Astro's [content collections](https://docs.astro.build/en/guides/content-collections/) map directly to the content directory.

### Pages

- **Index page**: Auto-generated table of contents from `schema.json`. Shows all sections and their tasks with completion status (researched vs. pending).
- **Section pages**: Lists all topics within a section.
- **Topic pages**: The actual researched content, rendered from markdown. Includes:
  - Last researched timestamp
  - Source links
  - Related topics (from same category)

### Rebuild Trigger

Cloudflare Pages watches the GitHub repo. Every `git push` triggers a rebuild. The Astro build reads `schema.json` and `content/**/*.md` to generate all pages.

### Styling

Use a clean, readable theme. Minimal CSS. The content is the focus. Consider [Starlight](https://starlight.astro.build/) (Astro's docs theme) as a starting point — it's built for exactly this kind of structured content site.

---

## Configuration

All configuration lives in environment variables on Railway. No config file is committed to either repo.

```typescript
interface NautilusConfig {
  telegramBotToken: string;           // From env: TELEGRAM_BOT_TOKEN
  telegramChatId: string;             // From env: TELEGRAM_CHAT_ID
  anthropicApiKey: string;            // From env: ANTHROPIC_API_KEY
  tavilyApiKey: string;               // From env: TAVILY_API_KEY
  githubToken: string;                // From env: GITHUB_TOKEN
  dataRepoUrl: string;                // From env: DATA_REPO_URL (e.g., "user/sea-nomad")
  defaultModel: string;               // From env or default: "claude-sonnet-4-5-20250929"
  heartbeatIntervalMinutes: number;   // From env or default: 30
  blindspotIntervalMinutes: number;   // From env or default: 360 (6 hours)
  maxStepsPerTask: number;            // From env or default: 25
  siteUrl: string;                    // From env: SITE_URL (Cloudflare Pages URL)
}
```

### Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...         # Anthropic Console API key
TAVILY_API_KEY=tvly-...              # Tavily API key
TELEGRAM_BOT_TOKEN=...               # From @BotFather
TELEGRAM_CHAT_ID=...                 # Your chat ID (set during onboarding)
GITHUB_TOKEN=...                     # For git push (fine-grained PAT)
DATA_REPO_URL=user/sea-nomad         # The project's data repo
SITE_URL=https://sea-nomad.pages.dev # The project's Cloudflare Pages URL
```

---

## Project Structure (Nautilus Source Code)

```
nautilus/
├── src/
│   ├── index.ts                     # Entry point: starts bot + heartbeats
│   ├── bot/
│   │   ├── bot.ts                   # grammy bot setup and command handlers
│   │   ├── commands/
│   │   │   ├── new.ts               # /new command + scoping conversation
│   │   │   ├── add.ts               # /add command
│   │   │   ├── blindspot.ts         # /blindspot command
│   │   │   ├── status.ts            # /status command
│   │   │   └── ...
│   │   └── notifications.ts         # Outbound Telegram messages
│   ├── blindspot/
│   │   ├── analyzer.ts              # Blindspot analysis LLM logic
│   │   └── heartbeat.ts             # Periodic blindspot timer
│   ├── research/
│   │   ├── heartbeat.ts             # Research heartbeat timer + task picker
│   │   ├── agent.ts                 # ToolLoopAgent setup + research execution
│   │   ├── tools.ts                 # Web search + web fetch tool definitions
│   │   └── prompts.ts               # System prompts and prompt builders
│   ├── project/
│   │   ├── scoping.ts               # Scoping conversation logic (title + scope only)
│   │   ├── backlog.ts               # Backlog management (add, pick, update)
│   │   └── schema.ts                # Document schema read/write/find
│   ├── site/
│   │   ├── generate.ts              # Generates toc.json and Astro content artifacts
│   │   └── scaffold.ts              # Astro site boilerplate (components, layouts)
│   ├── content/
│   │   ├── writer.ts                # Write markdown content files
│   │   └── frontmatter.ts           # Frontmatter generation
│   ├── git/
│   │   └── sync.ts                  # Git commit + push operations
│   └── config.ts                    # Configuration loading
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Deployment

### Railway (Nautilus Service)

1. Connect Railway to the Nautilus source repo.
2. Set environment variables in Railway dashboard.
3. Railway auto-deploys on every push to `main`.
4. The service runs `npm start` which starts the Telegram bot and heartbeat timer.

### Cloudflare Pages (Static Site)

1. Create a new Cloudflare Pages project connected to the project's data repo (e.g., `user/sea-nomad`).
2. Set build command: `cd site && npm run build`
3. Set output directory: `site/dist`
4. Every push to the data repo triggers a rebuild.
5. The site is available at `{project-slug}.pages.dev` (e.g., `sea-nomad.pages.dev`).

### GitHub (Data Repository)

Each project gets its own GitHub repo (e.g., `user/sea-nomad`) containing:
- Project state (JSON files at the root)
- Content (markdown files in `content/`)
- Astro site source (in `site/`)

This separation keeps the application code and the generated data/content in different repos. Each project repo maps 1:1 to a Cloudflare Pages deployment.

---

## MVP Constraints & Simplifications

- **Single project only**: The MVP supports one active project at a time. Multi-project is a future extension.
- **Single user**: One Telegram chat ID. No multi-user auth.
- **No content revision**: The MVP generates content once per task. Editing/revision is a future extension.
- **No cost tracking**: API costs are not tracked in the MVP. Use Anthropic Console dashboard.
- **No auto task splitting**: Tasks are created as-is. If a task is too broad, it may produce shallow content.
- **English only**: Content is generated in English.
- **No rate limiting**: Assumes reasonable usage. No per-task budget caps.
