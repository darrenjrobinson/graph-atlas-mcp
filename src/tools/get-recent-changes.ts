import { z } from 'zod';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

export const name = 'get_recent_changes';
export const description = 'Structured, filterable query over the change history — filter by date, endpoint, object type/name, change kind, and source.';

export const inputSchema = {
  since: z.string().optional().describe('ISO date (YYYY-MM-DD); defaults to 7 days ago'),
  endpoint: z.enum(['v1.0', 'beta']).optional(),
  object_type: z.string().optional().describe('e.g. EntityType, EnumType, ComplexType, ObjectInstance'),
  object_name: z.string().optional().describe('e.g. group, user, conditionalAccessPolicy'),
  change_kind: z.enum(['added', 'removed', 'modified', 'renamed', 'deprecated']).optional(),
  source: z.enum(['seed-entra-ms', 'backfill-graph-changelog', 'self']).optional(),
  limit: z.number().int().min(1).max(200).default(50),
};

type Args = {
  since?: string;
  endpoint?: 'v1.0' | 'beta';
  object_type?: string;
  object_name?: string;
  change_kind?: string;
  source?: string;
  limit?: number;
};

export function handler(db: DatabaseSync, args: Args) {
  const since = args.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const conditions = ['snapshot_date >= ?'];
  const params: SQLInputValue[] = [since];

  if (args.endpoint) {
    conditions.push('endpoint = ?');
    params.push(args.endpoint);
  }
  if (args.object_type) {
    conditions.push('object_type = ?');
    params.push(args.object_type);
  }
  if (args.object_name) {
    conditions.push('lower(object_name) = lower(?)');
    params.push(args.object_name);
  }
  if (args.change_kind) {
    conditions.push('change_kind = ?');
    params.push(args.change_kind);
  }
  if (args.source) {
    conditions.push('source = ?');
    params.push(args.source);
  }

  const limit = Math.min(args.limit ?? 50, 200);
  const sql = `SELECT * FROM changes WHERE ${conditions.join(' AND ')} ORDER BY detected_at DESC LIMIT ?`;
  const rows = db.prepare(sql).all(...params, limit);

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ since, count: rows.length, results: rows }, null, 2) }],
  };
}
