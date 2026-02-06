export interface SourceRef {
  url: string;
  title: string;
}

export interface FrontmatterInput {
  title: string;
  category: string;
  sources: SourceRef[];
  researchedAt: string;
}

function yamlString(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const escaped = normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function generateFrontmatter(input: FrontmatterInput): string {
  const sourceLines =
    input.sources.length === 0
      ? ['sources: []']
      : [
          'sources:',
          ...input.sources.flatMap((source) => [
            `  - url: ${yamlString(source.url)}`,
            `    title: ${yamlString(source.title)}`,
          ]),
        ];

  return [
    '---',
    `title: ${yamlString(input.title)}`,
    `category: ${yamlString(input.category)}`,
    ...sourceLines,
    `researchedAt: ${yamlString(input.researchedAt)}`,
    '---',
  ].join('\n');
}
