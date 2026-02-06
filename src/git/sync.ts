import { simpleGit, type SimpleGit } from 'simple-git';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import type { NautilusConfig } from '../config.js';

export interface DataRepo {
  ensureRepo(): Promise<void>;
  readJSON<T>(filePath: string): Promise<T>;
  writeJSON(filePath: string, data: unknown): Promise<void>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  commitAndPush(message: string): Promise<void>;
  getLocalPath(): string;
}

async function initDataRepo(config: NautilusConfig): Promise<DataRepo> {
  const slug = config.dataRepoUrl.split('/').pop()!;
  const localPath = join(homedir(), '.nautilus', 'data', slug);
  const remoteUrl = `https://${config.githubToken}@github.com/${config.dataRepoUrl}.git`;

  let queue: Promise<void> = Promise.resolve();
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const task = queue.then(fn);
    queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }

  let git: SimpleGit;
  const syncBranch = 'main';

  function isMissingRemoteMainRefError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.message.includes("couldn't find remote ref main") ||
        error.message.includes('could not find remote branch main'))
    );
  }

  async function pullIfRemoteMainExists(): Promise<void> {
    try {
      await git.pull('origin', syncBranch);
    } catch (error) {
      if (!isMissingRemoteMainRefError(error)) {
        throw error;
      }
    }
  }

  async function ensureRepo(): Promise<void> {
    return enqueue(async () => {
      if (existsSync(join(localPath, '.git'))) {
        git = simpleGit(localPath);
        await pullIfRemoteMainExists();
      } else {
        await mkdir(dirname(localPath), { recursive: true });
        await simpleGit().clone(remoteUrl, localPath);
        git = simpleGit(localPath);
      }
      await git.addConfig('user.email', 'nautilus@bot.local');
      await git.addConfig('user.name', 'Nautilus Bot');
    });
  }

  async function readJSONImpl<T>(filePath: string): Promise<T> {
    return enqueue(async () => {
      const fullPath = join(localPath, filePath);
      const content = await readFile(fullPath, 'utf-8');
      return JSON.parse(content) as T;
    });
  }

  async function writeJSONImpl(filePath: string, data: unknown): Promise<void> {
    return enqueue(async () => {
      const fullPath = join(localPath, filePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    });
  }

  async function readFileImpl(filePath: string): Promise<string> {
    return enqueue(async () => {
      const fullPath = join(localPath, filePath);
      return readFile(fullPath, 'utf-8');
    });
  }

  async function writeFileImpl(filePath: string, content: string): Promise<void> {
    return enqueue(async () => {
      const fullPath = join(localPath, filePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf-8');
    });
  }

  async function commitAndPush(message: string): Promise<void> {
    return enqueue(async () => {
      await pullIfRemoteMainExists();
      await git.add('.');
      const status = await git.status();
      if (status.files.length === 0) return;
      await git.commit(message);
      await git.raw(['push', '--set-upstream', 'origin', syncBranch]);
    });
  }

  function getLocalPath(): string {
    return localPath;
  }

  await ensureRepo();

  return {
    ensureRepo,
    readJSON: readJSONImpl,
    writeJSON: writeJSONImpl,
    readFile: readFileImpl,
    writeFile: writeFileImpl,
    commitAndPush,
    getLocalPath,
  };
}

let _repo: DataRepo | null = null;

export async function getDataRepo(config: NautilusConfig): Promise<DataRepo> {
  if (_repo) return _repo;
  _repo = await initDataRepo(config);
  return _repo;
}
