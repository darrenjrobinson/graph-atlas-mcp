import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { hybridSearch } from '../search.js';

export const name = 'search_changes';
export const description =
  'Search Microsoft Graph API change history using natural-language or keyword queries across all sources ' +
  '(seed-entra-ms, backfill-graph-changelog, self). Hybrid BM25-style keyword + semantic search, fused via ' +
  'Reciprocal Rank Fusion; degrades to keyword-only without OPENAI_API_KEY configured.';

export const inputSchema = {
  query: z.string().describe('Natural-language or keyword query, e.g. "groups API nesting", "ID Governance separation of duties"'),
  limit: z.number().int().min(1).max(50).default(10).describe('Max results (default 10, max 50)'),
  endpoint: z.enum(['v1.0', 'beta']).optional().describe('Filter to a specific Graph endpoint'),
  mode: z.enum(['hybrid', 'semantic', 'keyword']).default('hybrid').describe('Search mode — hybrid degrades to keyword automatically without an OpenAI key'),
};

export async function handler(
  db: DatabaseSync,
  args: { query: string; limit?: number; endpoint?: 'v1.0' | 'beta'; mode?: 'hybrid' | 'semantic' | 'keyword' },
) {
  const { mode, results } = await hybridSearch(db, args.query, { endpoint: args.endpoint, limit: args.limit, mode: args.mode });
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ query: args.query, mode, count: results.length, results }, null, 2),
      },
    ],
  };
}
