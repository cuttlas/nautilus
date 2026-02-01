import { promises as fs } from "node:fs";
import path from "node:path";
import type { Backlog, ProjectState } from "../types/index.js";

export async function initProject(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, "docs"), { recursive: true });
  await fs.mkdir(path.join(dir, "runs"), { recursive: true });
}

async function readTextFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function loadProject(dir: string): Promise<ProjectState> {
  const [scope, memory, docsMain, backlog] = await Promise.all([
    readTextFile(path.join(dir, "scope.md")),
    readTextFile(path.join(dir, "memory.md")),
    readTextFile(path.join(dir, "docs", "main.md")),
    readJsonFile<Backlog>(path.join(dir, "backlog.json"), { tasks: [] })
  ]);

  return {
    scope,
    backlog,
    memory,
    docs: { main: docsMain }
  };
}

export async function saveBacklog(dir: string, backlog: Backlog): Promise<void> {
  const payload = JSON.stringify(backlog, null, 2) + "\n";
  await fs.writeFile(path.join(dir, "backlog.json"), payload, "utf8");
}
