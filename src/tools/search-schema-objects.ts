import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { searchSchemaObjects } from '../schema-graph.js';
import { ok } from './app-helpers.js';

export const name = 'search_schema_objects';
export const description =
  'Name search across Graph entity types, permission scopes, and Entra roles — resolves fuzzy names to ' +
  'canonical node ids for visualize_schema_graph / expand_schema_node. Returns ranked candidates ' +
  '{id, kind, label, sub}; prefix matches rank first.';

export const inputSchema = {
  query: z.string().min(2),
  kinds: z.array(z.enum(['EntityType', 'Permission', 'Role'])).optional().describe('Restrict to these kinds; default all'),
  endpoint: z.enum(['v1.0', 'beta']).default('v1.0').describe('Snapshot used for entity type names'),
  limit: z.number().int().min(1).max(25).default(12),
};

export function handler(
  db: DatabaseSync,
  args: { query: string; kinds?: Array<'EntityType' | 'Permission' | 'Role'>; endpoint?: 'v1.0' | 'beta'; limit?: number },
) {
  const { results } = searchSchemaObjects(db, args);
  const text = results.length
    ? results.map((r) => `- ${r.label} (${r.kind}) — id: ${r.id} — ${r.sub}`).join('\n')
    : `No entity types, permissions, or roles match "${args.query}".`;
  return ok(text, { results });
}
