import type { DataRepo } from '../git/sync.js';
import type { Project } from '../types.js';

const PROJECT_FILE = 'project.json';

export async function readProject(repo: DataRepo): Promise<Project | null> {
  try {
    return await repo.readJSON<Project>(PROJECT_FILE);
  } catch {
    return null;
  }
}

export async function writeProject(repo: DataRepo, project: Project): Promise<void> {
  await repo.writeJSON(PROJECT_FILE, project);
}
