import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { entityNeighborhoodDelta, entityRolesDelta, entityUsageDelta, permissionDelta, roleDelta } from '../schema-graph.js';
import { ok, fail, deltaText } from './app-helpers.js';

export const name = 'expand_schema_node';
export const description =
  'Expand one node of the schema graph and return a {nodes, edges, message} delta to merge into the ' +
  'canvas — the interactive companion to visualize_schema_graph. kind="EntityType" with view="entity" ' +
  'returns the schema neighborhood (navigation targets, base type, referrers); with view="permission" ' +
  'the permissions that touch the entity; with view="role" those permissions plus the roles granting ' +
  'them (heuristic role map). kind="Permission" returns touched entities plus the roles granting it. ' +
  'kind="Role" returns granted permissions and their entities.';

export const inputSchema = {
  node_id: z.string().describe('Node id — lowercase entity type, permission name, or role name'),
  kind: z.enum(['EntityType', 'Permission', 'Role']),
  view: z.enum(['entity', 'permission', 'role']).default('entity').describe('Steers EntityType expansion: schema neighborhood vs permission usage'),
  endpoint: z.enum(['v1.0', 'beta']).default('v1.0').describe('Only applies to EntityType schema neighborhoods'),
  since: z.string().optional().describe('Change-activity window — ISO date or day count (e.g. "30")'),
};

export function handler(
  db: DatabaseSync,
  args: { node_id: string; kind: 'EntityType' | 'Permission' | 'Role'; view?: 'entity' | 'permission' | 'role'; endpoint?: 'v1.0' | 'beta'; since?: string },
) {
  const view = args.view ?? 'entity';
  const delta =
    args.kind === 'Role'
      ? roleDelta(db, { nodeId: args.node_id, since: args.since })
      : args.kind === 'Permission'
        ? permissionDelta(db, { nodeId: args.node_id, since: args.since })
        : view === 'entity'
          ? entityNeighborhoodDelta(db, { nodeId: args.node_id, endpoint: args.endpoint, since: args.since })
          : view === 'role'
            ? entityRolesDelta(db, { nodeId: args.node_id, since: args.since })
            : entityUsageDelta(db, { nodeId: args.node_id, since: args.since });

  if ('error' in delta) return fail(delta.error);
  return ok(deltaText(delta), delta as unknown as Record<string, unknown>);
}
