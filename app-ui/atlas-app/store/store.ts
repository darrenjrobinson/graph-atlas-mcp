// In-memory graph store in two layers (ported from EntraPulse Polyarchy):
//  - cache:   every node/edge ever fetched this session — survives canvas
//    resets so repeat explorations never re-hit the server
//  - display: what's currently on the canvas (nodes/edges/adjacency, pub/sub,
//    BFS hop distances)

import type { EdgeKind, GraphEdge, GraphNode, StoreSnapshot } from '../types.js';
import { endpointId } from './model.js';

const nodeCache = new Map<string, GraphNode>(); // id -> node (superset, owns the objects)
const edgeCache = new Map<string, GraphEdge>(); // id -> edge (superset)
const cacheIncident = new Map<string, Set<string>>(); // nodeId -> Set<edgeId> (for cache restore)

const nodes = new Map<string, GraphNode>(); // id -> node (displayed)
const edges = new Map<string, GraphEdge>(); // id -> edge (displayed)
const adjacency = new Map<string, Set<string>>(); // id -> Set<neighborId> (displayed)

let focusId: string | null = null;
let selectedId: string | null = null;
const listeners = new Set<(snap: StoreSnapshot) => void>();

export function subscribe(fn: (snap: StoreSnapshot) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  const snap = snapshot();
  listeners.forEach((fn) => fn(snap));
}

export function snapshot(): StoreSnapshot {
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    focusId,
    selectedId,
  };
}

export function getNode(id: string | null): GraphNode | undefined {
  if (id == null) return undefined;
  return nodes.get(id) ?? nodeCache.get(id);
}

function endpointsOf(e: GraphEdge): [string, string] {
  return [endpointId(e.source), endpointId(e.target)];
}

function displayNode(n: GraphNode | undefined) {
  if (!n || nodes.has(n.id)) return;
  nodes.set(n.id, n);
  if (!adjacency.has(n.id)) adjacency.set(n.id, new Set());
}

function displayEdge(e: GraphEdge) {
  if (edges.has(e.id)) return;
  edges.set(e.id, e);
  const [src, tgt] = endpointsOf(e);
  (adjacency.get(src) ?? adjacency.set(src, new Set()).get(src)!).add(tgt);
  (adjacency.get(tgt) ?? adjacency.set(tgt, new Set()).get(tgt)!).add(src);
}

export function upsertNode(node: GraphNode): GraphNode {
  let n = nodeCache.get(node.id);
  if (n) {
    // Keep runtime state (position, hop, expanded); MERGE the data bag so a sparse
    // re-fetch (e.g. an entity arriving via a permission's resource list) never
    // wipes rich fields fetched earlier from the schema snapshot.
    n.data = { ...n.data, ...node.data };
    // Labels only upgrade lowercase -> properly cased, never the reverse (entity
    // casing differs between the CSDL and the permission source data).
    if (n.label === n.label.toLowerCase() && node.label !== node.label.toLowerCase()) {
      n.label = node.label;
    }
  } else {
    n = node;
    nodeCache.set(n.id, n);
  }
  displayNode(n);
  return n;
}

export function upsertEdge(e: GraphEdge): GraphEdge {
  let ed = edgeCache.get(e.id);
  if (!ed) {
    ed = e;
    edgeCache.set(ed.id, ed);
    const [src, tgt] = endpointsOf(ed);
    (cacheIncident.get(src) ?? cacheIncident.set(src, new Set()).get(src)!).add(ed.id);
    (cacheIncident.get(tgt) ?? cacheIncident.set(tgt, new Set()).get(tgt)!).add(ed.id);
  }
  displayEdge(ed);
  return ed;
}

/** Wipe the canvas but keep the fetched-data cache. */
export function resetCanvas() {
  nodes.clear();
  edges.clear();
  adjacency.clear();
  focusId = null;
  selectedId = null;
  notify();
}

/**
 * Re-display a node's cached relationships of the given edge kinds without a
 * server call. Returns how many edges were brought back onto the canvas.
 */
export function restoreExpansion(nodeId: string, kinds: EdgeKind[]): number {
  const node = nodeCache.get(nodeId);
  if (!node) return 0;
  displayNode(node);
  let restored = 0;
  for (const edgeId of cacheIncident.get(nodeId) ?? []) {
    const e = edgeCache.get(edgeId);
    if (!e || !kinds.includes(e.kind)) continue;
    if (edges.has(e.id)) continue;
    const [src, tgt] = endpointsOf(e);
    displayNode(nodeCache.get(src));
    displayNode(nodeCache.get(tgt));
    displayEdge(e);
    restored++;
  }
  return restored;
}

export function neighbors(id: string): GraphNode[] {
  return [...(adjacency.get(id) ?? [])].map((nid) => nodes.get(nid)).filter((n): n is GraphNode => Boolean(n));
}

/** Undirected BFS from the focus node; unreachable nodes get Infinity. */
export function computeHops(fromId: string | null) {
  for (const n of nodes.values()) n.hop = Infinity;
  const start = fromId ? nodes.get(fromId) : undefined;
  if (!start) return;
  start.hop = 0;
  const queue = [start.id];
  while (queue.length) {
    const id = queue.shift()!;
    const hop = nodes.get(id)!.hop!;
    for (const nid of adjacency.get(id) ?? []) {
      const n = nodes.get(nid);
      if (n && n.hop === Infinity) {
        n.hop = hop + 1;
        queue.push(nid);
      }
    }
  }
}

/** The context flip: re-anchor hop distances on a new node. */
export function setFocus(id: string) {
  focusId = id;
  computeHops(id);
  notify();
}

export function getFocusId(): string | null {
  return focusId;
}

export function setSelected(id: string | null) {
  selectedId = id;
  notify();
}

export function getSelectedId(): string | null {
  return selectedId;
}

export function maxHop(): number {
  let max = 0;
  for (const n of nodes.values()) {
    if (n.hop !== Infinity && n.hop !== undefined && n.hop > max) max = n.hop;
  }
  return max;
}

export function clear() {
  nodeCache.clear();
  edgeCache.clear();
  cacheIncident.clear();
  nodes.clear();
  edges.clear();
  adjacency.clear();
  focusId = null;
  selectedId = null;
  notify();
}
