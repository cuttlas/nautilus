export type TaskStatus = "todo" | "done" | "obsolete";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number;
  depends_on: string[];
}

export interface Backlog {
  tasks: Task[];
}

export interface RunLog {
  task_executed: string;
  summary: string;
  docs_updated: string[];
  tasks_added: string[];
  sources: string[];
}

export interface ProjectDocs {
  main: string;
}

export interface ProjectState {
  scope: string;
  backlog: Backlog;
  memory: string;
  docs: ProjectDocs;
}
