import { Command } from "commander";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { initProject } from "../core/project.js";
import { AgentRunError, runAgent } from "../core/agent.js";

const mode1Tools = ["Read", "Write", "Edit", "Glob", "AskUserQuestion"];

async function promptForDescription(): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question("Describe the project scope: ");
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function ensureFile(filePath: string, contents: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    await fs.writeFile(filePath, contents, "utf8");
  }
}

function buildMode1Prompt(projectDir: string, description: string): string {
  return `You are Nautilus, a project execution system.

You are running in **Mode 1: New Project Initialization**.

Project directory: ${projectDir}

User description:
${description}

Your objective:
Transform a vague, incomplete human description into a clear project structure
that can be executed incrementally over time.

This mode is exploratory and interactive.

────────────────────────────────────────
PHASE 1 — SCOPE CLARIFICATION
────────────────────────────────────────

Your first responsibility is to understand the project well enough
to create a meaningful initial backlog.

You MUST:

- Identify unclear goals, constraints, and boundaries
- Ask clarifying questions using AskUserQuestion
- Ask questions in small batches (max 3 at a time)
- Wait for user responses before continuing

You SHOULD ask about:
- primary goal of the project
- intended outcome (decision, document, plan, knowledge base, etc.)
- constraints (time, budget, risk tolerance, scope limits)
- level of depth desired
- things explicitly out of scope

DO NOT:
- create files yet
- generate a backlog yet
- assume missing information without asking

Continue asking questions until:
- you can clearly describe what “done” means for this project
- the project boundaries are reasonably defined

When scope is clear, explicitly acknowledge:
“Scope understood. Initializing project.”

────────────────────────────────────────
PHASE 2 — PROJECT INITIALIZATION
────────────────────────────────────────

Once scope is clear, create the following files in ${projectDir}:

1. scope.md
2. backlog.json
3. docs/main.md
4. memory.md

────────────────────────────────────────
FILE REQUIREMENTS
────────────────────────────────────────

scope.md
- Summarize the project in clear, structured language
- Include:
  - project goal
  - intended outcome
  - constraints
  - priorities
  - explicit non-goals
- Be concise and readable
- Do NOT include speculation

memory.md
- Create the file
- Leave it empty
- Do NOT infer preferences or facts

docs/main.md
- Create an outline skeleton only
- Use headings representing major areas of work
- No detailed content yet

backlog.json

Schema:
{
  "tasks": [
    {
      "id": "t-001",
      "title": "...",
      "status": "todo",
      "priority": 1,
      "depends_on": []
    }
  ]
}

Backlog rules:
- Create initial tasks. As many as you think are needed.
- Tasks must represent gaps in understanding or required work
- Tasks must be:
  - specific
  - scoped
  - finishable in one future run
- Avoid vague tasks (e.g. “Research visas”)
- Prefer decision- or comparison-oriented phrasing
- Use priority 1–5 (5 = highest importance)
- All tasks start with status "todo"
- Dependencies may be used sparingly

────────────────────────────────────────
IMPORTANT CONSTRAINTS
────────────────────────────────────────

- Do NOT perform deep research in this mode
- Do NOT write final content
- Do NOT expand scope beyond what the user intends
- Do NOT guess or infer preferences
- This mode exists to prepare execution, not to execute

────────────────────────────────────────
COMPLETION
────────────────────────────────────────

When all files are created successfully:

- Provide a brief confirmation
- Summarize:
  - project goal
  - number of tasks created
  - what the first likely task will be

Then stop.
`;
}

export function newProjectCommand(): Command {
  const command = new Command("new");

  command
    .description("Create a new Nautilus project")
    .argument("<dir>", "Project directory")
    .option("-d, --description <text>", "Initial project description")
    .action(async (dir: string, options: { description?: string }) => {
      const projectDir = path.resolve(process.cwd(), dir);

      let existingEntries: string[] = [];
      try {
        existingEntries = await fs.readdir(projectDir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }

      if (existingEntries.length > 0) {
        console.error(`Directory is not empty: ${projectDir}`);
        process.exitCode = 1;
        return;
      }

      await initProject(projectDir);

      const description = options.description ?? (await promptForDescription());
      if (!description) {
        console.error("A project description is required.");
        process.exitCode = 1;
        return;
      }

      const prompt = buildMode1Prompt(projectDir, description);
      const previousCwd = process.cwd();

      try {
        process.chdir(projectDir);
        const output = await runAgent({
          prompt,
          allowedTools: mode1Tools,
        });
        if (!output.trim()) {
          console.warn(
            "[nautilus] Agent produced no output. If this persists, set NAUTILUS_AGENT_DEBUG=1 and verify your Claude authentication.",
          );
        }
      } catch (error) {
        if (error instanceof AgentRunError) {
          console.error("[nautilus] Agent request failed.");
          if (error.info.message) {
            console.error(`[nautilus] ${error.info.message}`);
          }
          if (error.info.statusCode) {
            console.error(`[nautilus] Status: ${error.info.statusCode}`);
          }
          if (error.info.requestId) {
            console.error(`[nautilus] Request ID: ${error.info.requestId}`);
          }
          console.error(
            "[nautilus] Please retry. If this persists, contact Anthropic support with the request ID.",
          );
          process.exitCode = 1;
          return;
        }
        throw error;
      } finally {
        process.chdir(previousCwd);
      }

      await ensureFile(path.join(projectDir, "scope.md"), "");
      await ensureFile(
        path.join(projectDir, "backlog.json"),
        JSON.stringify({ tasks: [] }, null, 2) + "\n",
      );
      await ensureFile(path.join(projectDir, "memory.md"), "");
      await ensureFile(path.join(projectDir, "docs", "main.md"), "");
    });

  return command;
}
