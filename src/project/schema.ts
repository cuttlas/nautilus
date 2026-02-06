import type { DataRepo } from '../git/sync.js';
import type { DocumentSchema, SchemaSection } from '../types.js';

const SCHEMA_FILE = 'schema.json';

export async function readSchema(repo: DataRepo): Promise<DocumentSchema> {
  try {
    return await repo.readJSON<DocumentSchema>(SCHEMA_FILE);
  } catch {
    return { title: '', description: '', sections: [] };
  }
}

export async function writeSchema(
  repo: DataRepo,
  schema: DocumentSchema,
): Promise<void> {
  await repo.writeJSON(SCHEMA_FILE, schema);
}

export function findSectionBySlug(
  schema: DocumentSchema,
  slug: string,
): SchemaSection | undefined {
  return schema.sections.find((s) => s.slug === slug);
}
