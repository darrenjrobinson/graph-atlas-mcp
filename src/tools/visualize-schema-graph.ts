import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { buildEntityGraph, buildPermissionGraph, buildRoleGraph, normalizeSince } from '../schema-graph.js';
import { ok, fail, deltaText } from './app-helpers.js';

export const name = 'visualize_schema_graph';
export const description =
  'Open the interactive Graph Atlas visualizer — a force-directed schema graph the user can search, ' +
  'expand node-by-node, and pivot across views. Pick the view that puts the pivot object in the right ' +
  'place for the question: "entity" for the Graph schema (nodes = entity types, colored by distance from ' +
  'the focus, with recent-change activity badges; edges = navigation properties/inheritance) — ' +
  'focus_object = an entity like "group". "permission" for a permission scope and the entities it ' +
  'touches plus the roles granting it — focus_object = a permission like "User.Invite.All". "role" for ' +
  'an Entra role, the permissions it grants, and the entities those touch — focus_object = a role like ' +
  '"User Administrator". Omit focus_object for an overview of the most consequential nodes. The user ' +
  'can continue exploring in the UI (expand_schema_node powers that); use schema_change_report for the ' +
  'same data without rendering.';

export const inputSchema = {
  view: z.enum(['entity', 'permission', 'role']).default('entity'),
  focus_object: z.string().optional().describe('Focus node — an entity type, permission name, or role name depending on view'),
  endpoint: z.enum(['v1.0', 'beta']).default('v1.0').describe('Only applies to view=entity'),
  since: z.string().optional().describe('Change-activity window — ISO date or day count (e.g. "30"); defaults to 30 days ago'),
};

export function handler(
  db: DatabaseSync,
  args: { view?: 'entity' | 'permission' | 'role'; focus_object?: string; endpoint?: 'v1.0' | 'beta'; since?: string },
) {
  const view = args.view ?? 'entity';
  const focusObject = args.focus_object;
  const result =
    view === 'permission'
      ? buildPermissionGraph(db, { focusObject, since: args.since })
      : view === 'role'
        ? buildRoleGraph(db, { focusObject, since: args.since })
        : buildEntityGraph(db, { endpoint: args.endpoint, focusObject, since: args.since });

  if ('error' in result) return fail(result.error);

  const focusText = result.focus_object ? `focused on "${result.focus_object}"` : 'overview of the most consequential nodes';
  const endpointText = result.endpoint ? ` (${result.endpoint})` : '';
  const message = `${view} view ${focusText}${endpointText} — ${result.nodes.length} of ${result.total_count} shown${result.truncated ? ', subset' : ''}`;

  // The seed envelope the app's ontoolresult handler recognizes ({atlas: 'opened'}).
  const seed = {
    atlas: 'opened',
    focusId: result.focus_object,
    view: result.view,
    endpoint: result.endpoint,
    snapshot_date: result.snapshot_date,
    since: normalizeSince(args.since),
    nodes: result.nodes,
    edges: result.edges,
    message,
    total_count: result.total_count,
    truncated: result.truncated,
  };
  return ok(deltaText({ nodes: result.nodes, edges: result.edges, message }), seed);
}
