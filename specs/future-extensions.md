# Nautilus Future Extensions Specification

This document describes features beyond the MVP that would make Nautilus a more powerful, polished research tool. Extensions are grouped by theme and roughly ordered by impact within each group.

---

## 1. Blindspot Detection Heartbeat

**Priority: High** — This is the most unique and valuable feature beyond the MVP.

### Overview

A second heartbeat that periodically analyzes the project's research coverage and suggests topics the user might have missed. Suggestions are sent to Telegram for approval before being added to the backlog.

### How It Works

1. Runs on a separate timer (default: every 24 hours).
2. Feeds Claude the full project context:
   - Original scope and scoping answers
   - Document schema (all sections/subsections)
   - List of completed tasks with brief summaries
   - Current backlog (queued tasks)
   - Category-level content summaries
3. Claude analyzes gaps using a structured prompt that asks it to think about:
   - Practical day-to-day concerns a first-timer wouldn't know to ask about
   - Cross-cutting concerns (e.g., how visa runs affect transport budget)
   - Recent developments or changes (2025-2026)
   - Edge cases and "gotchas"
   - Topics adjacent to existing research that add value
4. Uses `generateObject` to produce structured suggestions:

```typescript
interface BlindspotSuggestion {
  title: string;
  rationale: string;         // Why this is a blind spot
  category: string;          // Which section it belongs to
  estimatedDepth: 'overview' | 'detailed' | 'deep';
  relatedTasks: string[];    // IDs of related completed tasks
}
```

5. Sends suggestions to Telegram as inline keyboard buttons (Accept / Reject).
6. Accepted suggestions become backlog tasks with `source: 'blindspot'`.
7. Rejected suggestions are stored to avoid re-suggesting.

### Telegram UX

```
🔍 Blindspot Analysis — 3 suggestions:

1. "SIM Cards & Local Phone Numbers"
   Getting a local number is essential for banking apps, food delivery,
   and ride-hailing in SE Asia. ID requirements vary by country.
   [✅ Accept] [❌ Reject]

2. "Visa Run Logistics & Costs"
   Thailand's tourist visa requires exits every 60 days. Border run
   destinations, costs, and common pitfalls.
   [✅ Accept] [❌ Reject]

3. "Monsoon Season & Regional Weather Patterns"
   Weather varies dramatically across SE Asia. Travel timing affects
   which regions are pleasant vs. miserable.
   [✅ Accept] [❌ Reject]
```

### Configuration

```typescript
interface BlindspotConfig {
  enabled: boolean;                      // Default: true
  intervalHours: number;                 // Default: 24
  maxSuggestionsPerRun: number;          // Default: 5
  model: string;                         // Can use a cheaper model than research
}
```

---

## 2. Content Revision Workflow

**Priority: High** — Users will inevitably want to tweak generated content.

### Commands

| Command | Description |
|---|---|
| `/change <section> <instructions>` | Request changes to existing content |
| `/deeper <section>` | Request deeper research on a section |
| `/retry <taskId>` | Re-run a failed or unsatisfactory task |
| `/rewrite <section>` | Completely rewrite a section from scratch |

### How `/change` Works

1. User sends: `/change visas/thailand Add info about the new digital nomad visa introduced in 2025`
2. Nautilus reads the current content file for that section.
3. Creates a revision task that feeds Claude:
   - The current content
   - The user's change instructions
   - The original research task description
4. Claude edits the content (not a full rewrite — preserves existing research).
5. Updated content is committed and site is rebuilt.
6. User is notified with a diff summary and link.

### How `/deeper` Works

1. User sends: `/deeper healthcare/insurance`
2. Nautilus reads the current content and creates a "deepening" task.
3. The research agent is instructed to:
   - Read the existing content first
   - Identify areas that are shallow or lack specifics
   - Do additional web research to fill gaps
   - Expand the content with more detail, comparisons, costs, and practical advice
4. The content file is updated (appended to / expanded, not replaced).

### Revision Tracking

Each content file gains a `revisions` field in frontmatter:

```yaml
revisions:
  - date: "2026-02-10T09:00:00Z"
    type: "change"
    instructions: "Add digital nomad visa info"
  - date: "2026-02-15T14:00:00Z"
    type: "deeper"
```

---

## 3. Auto Task Splitting

**Priority: Medium** — Prevents shallow research on broad topics.

### Problem

Some tasks are too broad for a single research session (e.g., "Research accommodation in Thailand"). The agent might produce a surface-level overview instead of actionable detail.

### Solution

After the research agent completes a task, analyze the output. If the content is shallow (detected by heuristics: low word count, few sources, many sub-topics mentioned but not explored), automatically split it into sub-tasks.

### How It Works

1. After a task completes, run a quick analysis:
   - Word count < 300? Likely too shallow.
   - More than 4 H2 sections with < 100 words each? Topics mentioned but not explored.
2. If splitting is warranted, use `generateObject` to create sub-tasks:

```typescript
const { object } = await generateObject({
  model: anthropic('claude-haiku-4-5-20251001'),  // Cheap model for this
  schema: z.object({
    shouldSplit: z.boolean(),
    subtasks: z.array(z.object({
      title: z.string(),
      description: z.string(),
      category: z.string(),
    })),
  }),
  prompt: `Analyze this research output. Is it too shallow? Should it be split?
           Content: ${content}
           Original task: ${task.title}`,
});
```

3. Sub-tasks are added to the backlog with `parentTask` pointing to the original.
4. The original content is kept as an overview page; sub-task content becomes detailed sub-pages.

---

## 4. Cost Tracking & Budgets

**Priority: Medium** — Important for long-running projects.

### Per-Task Cost Tracking

Track token usage and cost for each research task:

```typescript
interface TaskCostRecord {
  taskId: string;
  inputTokens: number;
  outputTokens: number;
  searchApiCalls: number;
  estimatedCostUsd: number;
  model: string;
}
```

### Project Budget

```typescript
interface BudgetConfig {
  maxDailyBudgetUsd: number;          // Default: 2.00
  maxPerTaskBudgetUsd: number;        // Default: 0.50
  maxProjectBudgetUsd: number;        // Default: 50.00
  warningThresholdPercent: number;    // Default: 80 (notify at 80% spent)
}
```

### Behavior

- Before each heartbeat, check if daily/project budget allows another task.
- If budget is exhausted, pause the heartbeat and notify user.
- `/cost` command shows spending breakdown by task, category, and total.

### Telegram UX

```
💰 Cost Report — "SE Asia Nomad"
─────────────────────────
Tasks completed: 34/47
Total spent: $8.42

By category:
  Visas & Immigration:    $2.10 (8 tasks)
  Accommodation:          $1.85 (6 tasks)
  Healthcare:             $1.20 (5 tasks)
  ...

Today: $0.85 / $2.00 daily limit
Project: $8.42 / $50.00 budget
```

---

## 5. Content Freshness & Re-research

**Priority: Medium** — Critical for time-sensitive topics.

### Problem

Research about visas, prices, and regulations goes stale. Content researched 3 months ago might be outdated.

### Solution

Each content file has a `researchedAt` timestamp. A freshness sweep periodically identifies stale content and queues re-research tasks.

### Configuration

```typescript
interface FreshnessConfig {
  enabled: boolean;
  sweepIntervalDays: number;          // Default: 7 (check weekly)
  staleAfterDays: number;             // Default: 90
  categories: {                       // Override per category
    [category: string]: {
      staleAfterDays: number;         // e.g., visas: 30 days (changes often)
    };
  };
}
```

### How It Works

1. Weekly sweep checks all content files' `researchedAt` dates.
2. Stale content is flagged and a re-research task is created.
3. Re-research tasks instruct the agent to:
   - Read the existing content
   - Search for updates and changes since the original research date
   - Update only what has changed (preserve still-accurate information)
   - Update the `researchedAt` timestamp
4. User is notified of refreshed content.

### Site Integration

Pages show a freshness indicator:
- 🟢 Fresh (< 30 days)
- 🟡 Aging (30-90 days)
- 🔴 Stale (> 90 days)

---

## 6. Multi-Project Support

**Priority: Medium** — Natural extension once the MVP works.

### Changes

Since each project already has its own data repo and Cloudflare Pages site, multi-project is mostly about the Nautilus service managing multiple repos:

- The Nautilus service maintains a registry of projects (repo URL, site URL, status, heartbeat config).
- The Telegram bot supports multiple active projects.
- Commands are project-scoped: `/status sea-nomad`, `/add sea-nomad SIM cards`.
- Or set a "current project" context: `/switch sea-nomad`, then commands apply to it.
- Each project has its own heartbeat timer (can be paused independently).
- `/new` creates a new GitHub repo (via GitHub API), connects it to a new Cloudflare Pages project, and adds it to the registry.

### Telegram UX

```
/projects

📋 Your Projects:
1. 🟢 SE Asia Nomad — 34/47 tasks done (active)
2. ⏸️ Learn Rust — 12/28 tasks done (paused)
3. ✅ Home Renovation — 20/20 tasks done (completed)

Current: SE Asia Nomad
Use /switch <name> to change context.
```

---

## 7. Model Flexibility & Optimization

**Priority: Low** — Nice optimization, not essential.

### Smart Model Selection

Use different models for different task types to optimize cost:

| Task Type | Model | Reason |
|---|---|---|
| Deep research | Claude Sonnet 4.5 | Best at synthesis and web research |
| Task splitting | Claude Haiku 4.5 | Cheap, fast, good enough for analysis |
| Blindspot detection | Claude Sonnet 4.5 | Needs broad understanding |
| Backlog generation | Claude Sonnet 4.5 | Needs creativity |
| Content revision | Claude Sonnet 4.5 | Needs to understand existing content |
| Freshness check | Claude Haiku 4.5 | Simple comparison task |

### Provider Flexibility

Since we use Vercel AI SDK, switching providers is trivial:

```typescript
// Could use Gemini Flash for cheap tasks
import { google } from '@ai-sdk/google';
const cheapModel = google('gemini-2.0-flash');

// Or OpenAI for specific tasks
import { openai } from '@ai-sdk/openai';
const altModel = openai('gpt-4o-mini');
```

### Configuration

```typescript
interface ModelConfig {
  research: string;           // Default: "claude-sonnet-4-5-20250929"
  analysis: string;           // Default: "claude-haiku-4-5-20251001"
  scoping: string;            // Default: "claude-sonnet-4-5-20250929"
  revision: string;           // Default: "claude-sonnet-4-5-20250929"
}
```

---

## 8. Interactive Research Feedback

**Priority: Low** — Improves quality over time.

### Concept

After viewing a researched page, the user can rate it or provide feedback directly from Telegram:

```
✅ Completed: Thailand Visa Requirements
🔗 https://site.pages.dev/visas/thailand

Rate this research:
[👍 Good] [👎 Needs work] [🔄 Redo]
```

### Feedback Actions

- **Good**: No action needed. Marks the task quality as satisfactory. This data is used to tune future research prompts.
- **Needs work**: Bot asks "What's missing or wrong?" User replies with free text. Creates a `/change` revision task.
- **Redo**: Re-queues the task from scratch with higher depth.

### Quality Learning

Over time, feedback data helps tune the research system prompt. If certain categories consistently get "needs work" ratings, the system prompt can be adjusted to emphasize those areas.

---

## 9. Export & Sharing

**Priority: Low** — Convenience features.

### Export Formats

| Command | Output |
|---|---|
| `/export pdf` | Generate a PDF of the entire research document |
| `/export markdown` | Download all content as a zip of markdown files |
| `/export notion` | Push content to a Notion workspace |
| `/export obsidian` | Format content as an Obsidian vault |

### Sharing

- Generate a shareable link to the static site (already public via Cloudflare Pages).
- Option to make the site password-protected (Cloudflare Access).
- Generate a "research summary" — a one-page overview of all findings, suitable for sharing.

---

## 10. Research Sources & Citation Quality

**Priority: Low** — Improves trustworthiness.

### Source Scoring

Rate sources by reliability:
- Official government websites → high trust
- Established travel blogs/guides → medium trust
- Reddit/forum posts → low trust (but useful for anecdotes)
- AI-generated content → flag and deprioritize

### Cross-referencing

When researching a topic, the agent is instructed to:
- Find at least 3 independent sources for key claims
- Flag claims with only 1 source
- Note contradictions between sources
- Prefer primary sources (official sites) over secondary (blog posts)

### Site Integration

Each page shows a "source quality" indicator:
- Number of sources used
- Source type breakdown (official, blog, forum, etc.)
- Any flagged contradictions

---

## 11. Collaborative Research

**Priority: Low** — For teams or couples planning together.

### Multi-User Support

- Multiple Telegram users can interact with the same project.
- Each user can add topics, provide feedback, accept/reject blindspot suggestions.
- Notifications go to all registered users.
- Simple role model: `owner` (full control) and `contributor` (can add topics, give feedback).

### Telegram Group Support

Instead of a 1:1 chat with the bot, the bot can be added to a Telegram group. All project members interact in the group. The bot listens for commands and sends notifications to the group.

---

## 12. Research Templates

**Priority: Low** — Speeds up project creation for common use cases.

### Concept

Pre-built templates with curated scoping questions, document schemas, and starter backlogs for common research projects:

| Template | Description |
|---|---|
| `nomad-country` | Researching a specific country for digital nomading |
| `nomad-region` | Researching a region (SE Asia, Latin America, etc.) |
| `relocation` | Moving to a new city/country permanently |
| `travel-trip` | Planning a specific trip |
| `learning-topic` | Deep-diving into a learning subject |
| `home-renovation` | Planning a home renovation project |
| `career-change` | Researching a career pivot |

### Usage

```
/new --template nomad-region "SE Asia for 3 months"
```

The template pre-populates the schema and initial backlog, then the scoping conversation fills in personal details (nationality, budget, etc.).

---

## 13. Content Images

**Priority: Low** — Visual polish for the generated site.

### Overview

Add relevant images to research pages: photos for location-based content, maps for geographic topics, and diagrams where useful.

### Image Sources

| Source | Best for | Cost |
|---|---|---|
| Unsplash API | City/location photos, lifestyle imagery | Free (with attribution) |
| Static Maps (Google Maps / Mapbox) | Neighborhoods, areas, routes, visa run maps | Free tier available |
| AI-generated (DALL-E) | Diagrams, infographics | ~$0.04/image |

### How It Works

Add a `searchImage` tool to the research agent:

```typescript
searchImage: tool({
  description: 'Find a relevant photo for the content being researched',
  inputSchema: z.object({
    query: z.string().describe('Search query for a relevant photo'),
  }),
  execute: async ({ query }) => {
    const result = await unsplash.search.getPhotos({ query, perPage: 1 });
    const photo = result.response.results[0];
    return {
      url: photo.urls.regular,
      alt: photo.alt_description,
      credit: photo.user.name,
      creditUrl: photo.user.links.html,
    };
  },
}),
```

The `done` tool output gains an optional `image` field. The image URL and attribution go into the content frontmatter:

```yaml
---
title: "Chiang Mai Neighborhoods Guide"
image:
  url: "https://images.unsplash.com/photo-..."
  alt: "Chiang Mai old city temple"
  credit: "John Doe"
  creditUrl: "https://unsplash.com/@johndoe"
---
```

Astro renders it as a hero image at the top of the page with attribution.

### Static Maps

For location-based content, add a `generateMap` tool that takes a place name or coordinates and returns a static map URL. Useful for:
- City overview maps with key neighborhoods marked
- Visa run route maps
- Coworking space locations
- Hospital/clinic locations

---

## Extension Roadmap

Suggested implementation order after MVP:

| Phase | Extensions | Reason |
|---|---|---|
| **Phase 1** | Blindspot Detection, `/change` + `/deeper` | Highest value, makes the tool genuinely useful day-to-day |
| **Phase 2** | Cost Tracking, Auto Task Splitting | Operational maturity, prevents runaway costs |
| **Phase 3** | Content Freshness, Multi-Project | Long-term usability |
| **Phase 4** | Model Flexibility, Interactive Feedback | Optimization |
| **Phase 5** | Export, Templates, Collaborative, Images | Nice-to-haves |
