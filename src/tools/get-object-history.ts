import { z } from 'zod';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

export const name = 'get_object_history';
export const description = 'Full change history for a specific Graph object type, oldest to newest — "what has happened to X over time?"';

export const inputSchema = {
  object_name: z.string().describe('e.g. group, application, accessPackage, conditionalAccessPolicy'),
  endpoint: z.enum(['v1.0', 'beta']).optional(),
  since: z.string().optional().describe('ISO date (YYYY-MM-DD)'),
};

export function handler(db: DatabaseSync, args: { object_name: string; endpoint?: 'v1.0' | 'beta'; since?: string }) {
  // object_name casing differs across sources — seed data keeps CSDL casing (accessPackageSuggestion),
  // backfill data uses lowercase URL slugs (accesspackagesuggestion) — match case-insensitively.
  const conditions = ['lower(object_name) = lower(?)'];
  const params: SQLInputValue[] = [args.object_name];

  if (args.endpoint) {
    conditions.push('endpoint = ?');
    params.push(args.endpoint);
  }
  if (args.since) {
    conditions.push('snapshot_date >= ?');
    params.push(args.since);
  }

  const sql = `SELECT * FROM changes WHERE ${conditions.join(' AND ')} ORDER BY snapshot_date ASC, detected_at ASC`;
  const rows = db.prepare(sql).all(...params);

  return {
    content: [
      { type: 'text' as const, text: JSON.stringify({ object_name: args.object_name, count: rows.length, history: rows }, null, 2) },
    ],
  };
}
