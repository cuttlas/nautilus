# Nautilus — Product Specification

## Overview

Nautilus is a terminal-first system designed to help users **think, research, and create large knowledge artifacts over time**.

It is not a chatbot.
It is not an agent that acts autonomously.

It is a **project execution engine** where AI works through a backlog of incomplete understanding, one task at a time, with human guidance shaping scope and direction.

The core problem it solves:

> Long-lived projects cannot be completed in a single AI session, and conversational prompting collapses under time, context, and revision.

Nautilus turns research and planning into a **repeatable, inspectable, and evolvable process**.

---

## Design Principles

1. **Projects, not conversations**
   - State lives on disk
   - Progress persists across days or months

2. **Backlog-driven thinking**
   - What remains unknown is explicit
   - AI always knows what is left to do

3. **One task per run**
   - Each run is small, bounded, and auditable

4. **Human-in-the-loop direction**
   - User controls scope and priorities
   - AI executes within those boundaries

5. **Terminal-first**
   - Focus on cognition before UI
   - Deterministic and scriptable

6. **Static output, dynamic process**
   - Content is static (Markdown/HTML)
   - Intelligence lives in the run loop

---

## Core Concepts

### Project
A project is a folder containing:

- the evolving understanding of a topic
- a backlog of unresolved work
- generated documentation
- run history

A project represents **a long-lived thinking process**.

---

### Backlog

The backlog is the heart of the system.

It represents:
- unanswered questions
- missing research
- shallow areas
- synthesis yet to be done

The backlog is:
- fully AI-managed
- visible to the user
- dynamically updated after every run

The user does **not** manually edit the backlog.
They influence it indirectly through scope changes and feedback.

---

### Task

A task is a single, finishable unit of thinking.

Good tasks:
- are specific
- are scoped
- can be completed in one run

Examples:
- "Compare visa options for 2–4 month stays in Thailand and Vietnam"
- "Analyze rainy seasons to determine worst travel months"

Bad tasks:
- "Thailand visas"
- "Weather"

Each task represents a concrete gap in understanding.

---

### Run

A run is a single execution of the system.

Each run:
- selects one task
- performs deep research
- updates project documentation
- updates the backlog
- records its outcome

Runs are deterministic and reviewable.

---

## File Structure

```
project/
  scope.md
  backlog.json
  memory.md
  docs/
    main.md
  runs/
```

### scope.md

Defines the purpose and boundaries of the project.

Contains:
- original user intent
- clarified goals
- constraints
- priorities

This file changes rarely.

---

### backlog.json

The authoritative list of remaining work.

Minimal schema:

```json
{
  "tasks": [
    {
      "id": "t-001",
      "title": "Compare visa options for 2–3 month stays",
      "status": "todo",
      "priority": 3,
      "depends_on": []
    }
  ]
}
```

Allowed statuses:
- `todo`
- `done`
- `obsolete`

---

### memory.md

Stores **durable knowledge** discovered during execution.

Examples:
- confirmed constraints
- explicit decisions
- preferences that repeatedly affect tasks

Rules:
- no speculation
- no guesses
- only information that proved useful across runs

---

### docs/

Contains generated project content.

Initially minimal.
Grows organically through runs.

Markdown recommended for MVP.

---

### runs/

Each run writes a log file:

```json
{
  "task_executed": "t-004",
  "summary": "Researched Thailand and Vietnam visa options",
  "docs_updated": ["docs/main.md"],
  "tasks_added": ["t-010"],
  "sources": ["https://..."]
}
```

Provides auditability and reasoning trace.

---

## Operating Modes

The system has exactly **three modes**.

Each mode has strict permissions.

---

## Mode 1 — New Project

### Purpose

Establish the problem space and initial work graph.

### User Input

A free-form description of the project scope.

Example:

> "Digital nomad planning in Southeast Asia. I want to research visas, weather, routes, food, culture, festivals, scams, transportation, and hidden gems."

### Allowed AI Behavior

- ask clarifying questions (unlimited)
- refine scope
- identify major dimensions of the problem
- generate initial backlog
- create initial docs skeleton

### Output

- scope.md
- backlog.json (15–25 initial tasks)
- docs/main.md (outline only)

This is the **only mode** where extended back-and-forth is allowed.

---

## Mode 2 — Run Task

### Purpose

Execute one unit of work.

### Flow

1. Load scope, backlog, memory, docs
2. Suggest next task from backlog
3. User may:
   - accept
   - add brief context
   - override with a different task
   - **reject the suggested task**
4. If the user rejects:
   - the AI removes the task from the backlog by marking it `obsolete` (default) or `done` if it was already satisfied
   - the AI immediately suggests the next best task
   - the user can repeat rejection until a task is accepted or overridden
5. AI executes the accepted/overridden task
6. Documentation updated
7. Backlog updated
8. Run log written

### Task Suggestion and Rejection Rules

- Task suggestion must be drawn from `todo` tasks whose dependencies are satisfied.
- The user can reject a suggested task with a simple "reject" intent.
- Rejected tasks must not be re-suggested in future runs unless explicitly reintroduced via **Manage Scope**.
- Rejection is treated as a signal that the task is out of scope or not valuable *right now*.

### Clarifying Questions Rule

Allowed only if:

> The task cannot be executed without choosing between mutually exclusive interpretations.

Maximum: **2 questions**.

Otherwise, the AI must proceed.

### Allowed AI Behavior

- deep web research
- synthesis
- writing content
- marking tasks done
- adding up to 3 new tasks (as optional follow-ups)
- merging or deduplicating tasks
- updating memory.md when justified
- handling task rejection as defined above

### Not Allowed

- redefining project goals
- large scope expansion
- free-form brainstorming

This mode is execution-only.

---

## Mode 3 — Manage Scope

### Purpose

Strategic adjustment of project direction.

### User Input

Examples:
- "I want to prioritize slow travel and fewer flights"
- "I no longer care about Indonesia"
- "Help me brainstorm missing areas"

### Allowed AI Behavior

- update scope.md
- add or remove backlog tasks
- reprioritize tasks
- mark tasks obsolete
- brainstorm expansions

### Not Allowed

- deep research
- writing documentation

This mode is planning-only.

---

## Backlog Management Rules

1. One task is completed per run
2. Max 3 new tasks added per run
3. Tasks must be actionable and scoped
4. Duplicate tasks must be merged
5. Tasks can be marked obsolete, not deleted

The backlog must remain readable and meaningful.

---

## Why This System Exists

Traditional prompting fails for long-lived thinking because:

- conversations are linear
- memory is implicit
- unfinished work is invisible
- revision is fragile

Nautilus externalizes cognition:

- knowledge lives in documents
- uncertainty lives in backlog
- evolution lives in Git history

The system supports:

- thinking across time
- iterative correction
- gradual understanding
- intentional incompleteness

---

## Non-Goals (Explicit)

The system does NOT aim to:

- fully automate projects
- replace human judgment
- run indefinitely without oversight
- act autonomously

It is a **thinking partner with structure**, not an independent agent.

---

## Success Criteria

The product is successful if:

- users can pause for weeks and resume instantly
- the backlog clearly shows what remains
- documents improve after every run
- users feel reduced cognitive load
- progress compounds over time

---

## Future (Out of Scope for MVP)

- Web UI
- Dependency graphs
- Section-level recomputation
- Scheduling
- Multi-project dashboards
- Collaboration

These can be layered later.

---

## Summary

Nautilus is a system for:

> Turning vague, evolving problems into structured, persistent thinking processes.

It replaces endless prompting with:

- projects
- backlogs
- runs
- revision

Like its namesake, Nautilus grows understanding in chambers — each run adding a new layer, while preserving everything that came before.

The goal is not speed.

The goal is **understanding that survives time**.

