import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { getPermissionsForObject, getRelatedPermissions } from '../permissions.js';

export const name = 'get_permission_context';
export const description =
  'Two modes. (1) Pass object_name: which permissions touch a Graph object, what each unlocks, who can grant them, ' +
  'and its recent changes. (2) Pass permission_name alone (e.g. when comparing "is there a less-privileged alternative ' +
  'to Synchronization.ReadWrite.All"): that permission\'s detail plus other permissions with overlapping resource scope, ' +
  'annotated with resource_count and is_ownership_scoped (OwnedBy-suffixed permissions restrict to owned objects only) ' +
  'so you can reason about the tradeoff yourself — this does NOT rank or claim to compute "least privilege" automatically, ' +
  'since resource-type count and instance-level ownership scoping are different privilege axes. ' +
  'Role<->permission cross-referencing is a heuristic correlation (no official Microsoft crosswalk exists) — treat ' +
  '"grantable_by" as a strong signal to verify, not ground truth.';

export const inputSchema = {
  object_name: z.string().optional().describe('e.g. administrativeUnit, user, group, accessPackage, synchronizationJob'),
  endpoint: z.enum(['v1.0', 'beta']).optional(),
  permission_name: z.string().optional().describe(
    'A specific permission scope, e.g. AdministrativeUnit.Read.All or Synchronization.ReadWrite.All. ' +
    'If object_name is omitted, returns this permission\'s detail plus resource-overlapping alternatives to compare.',
  ),
  limit: z.number().int().min(1).max(50).default(25).describe(
    'Max permissions to return when using object_name (sorted narrowest-first by resource count); broad objects like "user" can match 100+',
  ),
};

export function handler(db: DatabaseSync, args: { object_name?: string; endpoint?: 'v1.0' | 'beta'; permission_name?: string; limit?: number }) {
  if (!args.object_name && !args.permission_name) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Provide object_name and/or permission_name.' }) }],
      isError: true,
    };
  }

  if (!args.object_name && args.permission_name) {
    const result = getRelatedPermissions(db, args.permission_name);
    if (!result) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `No permission named ${args.permission_name}` }) }],
        isError: true,
      };
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }

  const objectName = args.object_name as string;
  const { permissions, total_matching_count } = getPermissionsForObject(db, objectName, {
    permissionName: args.permission_name,
    limit: args.limit,
  });

  const changeConditions = ['lower(object_name) = ?'];
  const changeParams: unknown[] = [objectName.toLowerCase()];
  if (args.endpoint) {
    changeConditions.push('endpoint = ?');
    changeParams.push(args.endpoint);
  }
  const recentChanges = db
    .prepare(`
      SELECT property_name, change_kind, snapshot_date, endpoint FROM changes
      WHERE ${changeConditions.join(' AND ')}
      ORDER BY detected_at DESC LIMIT 10
    `)
    .all(...(changeParams as never[]));

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          { object_name: objectName, permissions, total_matching_count, permissions_shown: permissions.length, recent_changes: recentChanges },
          null,
          2,
        ),
      },
    ],
  };
}
