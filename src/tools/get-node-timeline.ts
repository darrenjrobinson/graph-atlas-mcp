import { z } from 'zod';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { normalizeSince } from '../schema-graph.js';
import { ok, fail } from './app-helpers.js';

export const name = 'get_node_timeline';
export const description =
  'Compact newest-first change timeline for one schema object, sized for the visualizer detail panel. ' +
  'App-facing companion to get_object_history.';

export const inputSchema = {
  node_id: z.string().describe('Entity type name (case-insensitive)'),
  endpoint: z.enum(['v1.0', 'beta']).optional(),
  since: z.string().optional().describe('ISO date or day count (e.g. "90")'),
  limit: z.number().int().min(1).max(50).default(20),
};

export function handler(db: DatabaseSync, args: { node_id: string; endpoint?: 'v1.0' | 'beta'; since?: string; limit?: number }) {
  // object_name casing differs across sources (CSDL camelCase vs lowercase URL slugs) — match
  // case-insensitively, same as get_object_history.
  const conditions = ['lower(object_name) = lower(?)'];
  const params: SQLInputValue[] = [args.node_id];

  if (args.endpoint) {
    conditions.push('endpoint = ?');
    params.push(args.endpoint);
  }
  if (args.since) {
    conditions.push('snapshot_date >= ?');
    params.push(normalizeSince(args.since));
  }

  const where = conditions.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) c FROM changes WHERE ${where}`).get(...params) as { c: number }).c;
  if (total === 0) return fail(`No recorded changes for "${args.node_id}".`);

  const limit = args.limit ?? 20;
  const events = db
    .prepare(
      `SELECT snapshot_date, endpoint, change_kind, property_name, description FROM changes
       WHERE ${where} ORDER BY snapshot_date DESC, detected_at DESC LIMIT ?`,
    )
    .all(...params, limit) as Array<{
    snapshot_date: string;
    endpoint: string;
    change_kind: string;
    property_name: string | null;
    description: string | null;
  }>;

  return ok(`${args.node_id}: ${total} change(s), returning ${events.length}`, { object: args.node_id, total, events });
}
