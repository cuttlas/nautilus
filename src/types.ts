export interface ResearchTask {
  id: string;
  title: string;
  description: string;
  category: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  outputPath?: string;
}

export interface Backlog {
  tasks: ResearchTask[];
}

export interface SchemaSubsection {
  slug: string;
  title: string;
  taskIds: string[];
}

export interface SchemaSection {
  slug: string;
  title: string;
  description: string;
  order: number;
  subsections: SchemaSubsection[];
}

export interface DocumentSchema {
  title: string;
  description: string;
  sections: SchemaSection[];
}

export interface Project {
  id: string;
  slug: string;
  title: string;
  scope: string;
  scopingAnswers: Record<string, string>;
  status: 'scoping' | 'active' | 'paused' | 'completed';
  heartbeatIntervalMinutes: number;
  model: string;
  createdAt: string;
  updatedAt: string;
  siteUrl: string;
}
