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

export async function addSection(
  repo: DataRepo,
  section: SchemaSection,
): Promise<DocumentSchema> {
  const schema = await readSchema(repo);
  schema.sections.push(section);
  schema.sections.sort((a, b) => a.order - b.order);
  await repo.writeJSON(SCHEMA_FILE, schema);
  return schema;
}

export function findSectionBySlug(
  schema: DocumentSchema,
  slug: string,
): SchemaSection | undefined {
  return schema.sections.find((s) => s.slug === slug);
}
