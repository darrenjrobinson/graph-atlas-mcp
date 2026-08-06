import { z } from 'zod';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

export const name = 'get_snapshot_summary';
export const description = 'Snapshot metadata — entity/property/enum counts, CSDL size, change count. "How big is Graph API now?" and trend analysis.';

export const inputSchema = {
  date: z.string().optional().describe('ISO date (YYYY-MM-DD); defaults to latest'),
  endpoint: z.enum(['v1.0', 'beta']).optional(),
};

export function handler(db: DatabaseSync, args: { date?: string; endpoint?: 'v1.0' | 'beta' }) {
  const conditions: string[] = [];
  const params: SQLInputValue[] = [];

  if (args.date) {
    conditions.push('snapshot_date = ?');
    params.push(args.date);
  }
  if (args.endpoint) {
    conditions.push('endpoint = ?');
    params.push(args.endpoint);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderLimit = args.date ? '' : 'ORDER BY snapshot_date DESC LIMIT 10';
  const sql = `SELECT * FROM snapshots ${where} ${orderLimit}`;
  const rows = db.prepare(sql).all(...params);

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ count: rows.length, snapshots: rows }, null, 2) }],
  };
}
