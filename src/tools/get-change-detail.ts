import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { getPermissionsForObject } from '../permissions.js';

export const name = 'get_change_detail';
export const description =
  'Full detail for a single change record, including related changes from the same snapshot/object, and permission ' +
  'context (required permissions, admin consent, grantable-by roles — see get_permission_context for the heuristic caveat).';

export const inputSchema = {
  change_id: z.number().int().describe('Change record ID'),
};

export function handler(db: DatabaseSync, args: { change_id: number }) {
  const change = db.prepare('SELECT * FROM changes WHERE id = ?').get(args.change_id);
  if (!change) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: `No change record with id ${args.change_id}` }) }],
      isError: true,
    };
  }

  const c = change as { snapshot_date: string; object_name: string | null; id: number };
  const related = db
    .prepare(
      'SELECT * FROM changes WHERE snapshot_date = ? AND object_name IS ? AND id != ? ORDER BY detected_at ASC',
    )
    .all(c.snapshot_date, c.object_name, c.id);

  const permissionContext = c.object_name ? getPermissionsForObject(db, c.object_name, { limit: 10 }).permissions : [];

  return {
    content: [
      { type: 'text' as const, text: JSON.stringify({ change, related_changes: related, permission_context: permissionContext }, null, 2) },
    ],
  };
}
