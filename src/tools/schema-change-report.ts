import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { buildEntityGraph, buildPermissionGraph, buildRoleGraph } from '../schema-graph.js';

export const name = 'schema_change_report';
export const description =
  'Structured JSON of a schema/permission/role graph (nodes + edges) with change-activity counts, for reasoning ' +
  'over — no UI. view="entity": Graph entity types (focus_object = an entity like "group"). view="permission": ' +
  'permission scopes and the entities they touch (focus_object = a permission like "User.Invite.All"). ' +
  'view="role": Entra roles, the permissions they grant, and the entities those touch (focus_object = a role like ' +
  '"User Administrator") — use this to compare what different roles can actually do. Omit focus_object for an ' +
  'overview of the most consequential entities/permissions/roles. Same data as visualize_schema_graph, without ' +
  'rendering it.';

export const inputSchema = {
  view: z.enum(['entity', 'permission', 'role']).default('entity'),
  object_name: z.string().optional().describe('Focus node — an entity type, permission name, or role name depending on view'),
  endpoint: z.enum(['v1.0', 'beta']).default('v1.0').describe('Only applies to view=entity'),
  since: z.string().optional().describe('ISO date for the change-activity window; defaults to 30 days ago'),
  limit: z.number().int().min(5).max(100).optional(),
};

export function handler(
  db: DatabaseSync,
  args: { view?: 'entity' | 'permission' | 'role'; object_name?: string; endpoint?: 'v1.0' | 'beta'; since?: string; limit?: number },
) {
  const view = args.view ?? 'entity';
  const result =
    view === 'permission'
      ? buildPermissionGraph(db, { focusObject: args.object_name, since: args.since, limit: args.limit })
      : view === 'role'
        ? buildRoleGraph(db, { focusObject: args.object_name, since: args.since, limit: args.limit })
        : buildEntityGraph(db, { endpoint: args.endpoint, focusObject: args.object_name, since: args.since, limit: args.limit });

  if ('error' in result) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], isError: true };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}
