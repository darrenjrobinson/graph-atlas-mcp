import type { EdgeKind, NodeKind } from '../types.js';

export const EDGE_KINDS: EdgeKind[] = ['navigation_property', 'inheritance', 'grants', 'touches'];

export const NODE_KINDS: NodeKind[] = ['EntityType', 'Permission', 'Role'];

/** Resolve an edge endpoint to its node id — d3 rewrites source/target into node objects. */
export function endpointId(endpoint: string | { id: string }): string {
  return typeof endpoint === 'object' ? endpoint.id : endpoint;
}
