// The server contract (src/schema-graph.ts) plus the runtime fields the store and
// d3 add client-side. All domain fields live in the `data` bag; UI code branches
// only on `kind`.

export type NodeKind = 'EntityType' | 'Permission' | 'Role';
export type EdgeKind = 'navigation_property' | 'inheritance' | 'grants' | 'touches';
export type ViewKind = 'entity' | 'permission' | 'role';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  data: Record<string, unknown>;
  // runtime state — managed by the store and d3, never sent by the server
  hop?: number;
  expanded?: boolean;
  expandedIn?: Set<string>;
  timeline?: { total: number; events: TimelineEvent[] };
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  id: string;
  // d3's force layout rewrites these from id strings into node object references
  source: string | GraphNode;
  target: string | GraphNode;
  kind: EdgeKind;
  label: string;
}

export interface Delta {
  nodes: GraphNode[];
  edges: GraphEdge[];
  message?: string;
}

/** What visualize_schema_graph returns as structuredContent. */
export interface Seed extends Delta {
  atlas: 'opened';
  focusId: string | null;
  view: ViewKind;
  endpoint: string | null;
  snapshot_date: string | null;
  since: string;
  message: string;
  total_count: number;
  truncated: boolean;
}

export interface SearchResult {
  id: string;
  kind: NodeKind;
  label: string;
  sub: string;
}

export interface TimelineEvent {
  snapshot_date: string;
  endpoint: string;
  change_kind: string;
  property_name: string | null;
  description: string | null;
}

export interface StoreSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusId: string | null;
  selectedId: string | null;
}
