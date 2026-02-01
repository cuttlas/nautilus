# Nautilus - Tech Stack

## Core Runtime

| Component | Choice | Notes |
|-----------|--------|-------|
| Runtime | Node.js (LTS 20+) | TypeScript target |
| Language | TypeScript | Type safety for project state management |
| AI Engine | `@anthropic-ai/claude-agent-sdk` | Handles agent loop, tool execution |

## Claude Agent SDK

### What We Use

| Feature | Purpose | Modes |
|---------|---------|-------|
| `query()` | Core function to run the agent | All |
| `Read` | Load scope.md, backlog.json, memory.md, docs | All |
| `Write` / `Edit` | Update docs, backlog, memory | 1, 2 |
| `Glob` / `Grep` | Find/search project files | All |
| `WebSearch` / `WebFetch` | Research during task execution | 2 |
| `AskUserQuestion` | Clarifying questions | 1, 2 (max 2) |
| `allowedTools` | Restrict tools per mode | All |
| `permissionMode: "bypassPermissions"` | We control the project dir | All |

### What We Don't Use

| Feature | Why Not |
|---------|---------|
| Sessions | Each run loads fresh context from files - that's the whole point |
| Subagents | Single agent is sufficient |
| Hooks | We log runs ourselves after `query()` completes |
| MCP servers | Public web is enough for MVP |

### Per-Mode Tool Configuration

```typescript
// Mode 1: New Project - conversation + file creation
const mode1Tools = ["Read", "Write", "Edit", "Glob", "AskUserQuestion"];

// Mode 2: Run Task - research + file updates
const mode2Tools = ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "AskUserQuestion"];

// Mode 3: Manage Scope - planning only, no research
const mode3Tools = ["Read", "Write", "Edit", "Glob"];
```

### Basic Usage Pattern

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: buildPromptWithContext(mode, projectState),
  options: {
    allowedTools: toolsForMode[mode],
    permissionMode: "bypassPermissions"
  }
})) {
  // stream output to terminal
  // capture final result for run log
}
```

The SDK is a smart agent loop. We handle:
- Loading project state into the prompt
- Parsing/validating the output
- Writing run logs

### Requirements

- Claude Code CLI must be installed
- `ANTHROPIC_API_KEY` environment variable

## CLI Framework

| Option | Pros | Cons |
|--------|------|------|
| **Commander.js** | Simple, well-documented, lightweight | - |
| yargs | More features | Heavier |
| No framework | Zero deps | More manual work |

**Recommendation:** Commander.js - mature, minimal, fits the terminal-first philosophy.

## Terminal UX

**Minimal approach:** Let the Agent SDK handle output streaming. User input via SDK's `AskUserQuestion` tool. No additional terminal UI libraries for MVP.

## Project State

All state is file-based (per spec):

```
project/
  scope.md          # Markdown
  backlog.json      # JSON (typed with TypeScript interfaces)
  memory.md         # Markdown
  docs/
    main.md
  runs/
    run-001.json    # JSON logs
```

**No database needed** - Git provides history, JSON/Markdown provides structure.

## Build & Development

| Tool | Purpose |
|------|---------|
| `tsx` | Run TypeScript directly during dev |
| `tsup` or `esbuild` | Bundle for distribution |
| `vitest` | Testing |

## Decisions

1. **Interactive mode:** Use SDK's built-in `AskUserQuestion` tool for clarifying questions in Mode 1.

2. **Terminal UX:** Keep it minimal - streaming output from the agent, no fancy spinners/colors for MVP.

3. **Distribution:** npx execution (`npx nautilus`) - zero install friction.

4. **MCP servers:** None for MVP. Built-in `WebSearch` + `WebFetch` cover research needs. Playwright MCP would only be needed for JS-heavy or authenticated sites.

## Proposed Package.json Dependencies

```json
{
  "name": "nautilus",
  "bin": {
    "nautilus": "./dist/index.js"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^latest",
    "commander": "^12.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsx": "^4.0.0",
    "tsup": "^8.0.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  }
}
```

With the `bin` field, users can run `npx nautilus` directly.

## Architecture Sketch

```
src/
  index.ts           # CLI entry point
  commands/
    new.ts           # Mode 1: New Project
    run.ts           # Mode 2: Run Task
    scope.ts         # Mode 3: Manage Scope
  core/
    project.ts       # Load/save project state
    backlog.ts       # Backlog operations
    agent.ts         # Claude Agent SDK wrapper
  types/
    project.ts       # TypeScript interfaces
```

## Next Steps

1. Confirm tech choices
2. Initialize project with package.json and tsconfig
3. Implement project state types and I/O
4. Build Mode 2 (Run Task) first - it's the core loop
5. Add Mode 1 and Mode 3
