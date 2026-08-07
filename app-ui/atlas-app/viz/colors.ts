import * as d3 from 'd3';
import type { EdgeKind, GraphNode, NodeKind } from '../types.js';

// Edges — one color per relationship kind. #e05263 (--danger) is deliberately
// excluded from this palette: it's reserved as the privileged/admin-consent
// signal ring so red always means "risk", never "relationship".
export const edgeColor = d3
  .scaleOrdinal<string, string>()
  .domain(['navigation_property', 'inheritance', 'grants', 'touches'])
  .range(['#4f8ef7', '#9d7bd8', '#f7b84b', '#34c38f']);

export const EDGE_LABELS: Record<EdgeKind, string> = {
  navigation_property: 'Navigates to',
  inheritance: 'Inherits from',
  grants: 'Grants',
  touches: 'Touches',
};

export const NODE_KIND_LABELS: Record<NodeKind, string> = {
  EntityType: 'Entity type',
  Permission: 'Permission',
  Role: 'Role',
};

export const UNREACHABLE = '#4a5568';
export const DANGER = '#e05263';
export const ACTIVITY = '#f7b84b';

export function isLightTheme(): boolean {
  return document.documentElement.dataset.theme === 'light';
}

/** Node outline that separates nodes from the canvas in either theme. */
export function nodeStroke(): string {
  return isLightTheme() ? '#ffffff' : '#0e1117';
}

/**
 * Node fill by degrees of separation from the focal node.
 * The focus gets the highest contrast against the canvas: near-white blue on
 * the dark theme, deep navy on the light theme; each hop steps toward the
 * background. Infinity = unreachable grey.
 */
export function hopColor(hop: number | undefined, maxHop: number): string {
  if (hop === Infinity || hop == null) return UNREACHABLE;
  const span = Math.max(maxHop, 1);
  const t = Math.min(hop / span, 1);
  // interpolateBlues: 0 = near-white, 1 = dark navy
  return d3.interpolateBlues(isLightTheme() ? 0.9 - t * 0.55 : 0.25 + t * 0.55);
}

/** Sample swatches for the legend hop ramp. */
export function hopRamp(steps = 5): string[] {
  return d3.range(steps).map((i) => hopColor(i, steps - 1));
}

// Permissions and roles take the colour of the relationship that connects them,
// so nodes complement their lines. Entity types keep the blue hop ramp.
const KIND_EDGE_KIND: Partial<Record<NodeKind, EdgeKind>> = {
  Permission: 'touches',
  Role: 'grants',
};

/** The edge-palette colour for a node kind, or null for entity types. */
export function nodeKindColor(kind: NodeKind): string | null {
  const edgeKind = KIND_EDGE_KIND[kind];
  return edgeKind ? edgeColor(edgeKind) : null;
}

/**
 * Node fill: entity types shade by hop distance; permissions/roles wear their
 * relationship colour, faded toward the canvas with distance so the hop cue
 * survives. Without a focus (overview seed, post-reset) there are no hops —
 * entities sit at a fixed mid-ramp and typed nodes at full colour, so the
 * canvas never collapses to unreachable-grey.
 */
export function nodeFill(d: GraphNode, maxHop: number, hasFocus: boolean): string {
  const kindColor = nodeKindColor(d.kind);
  if (!hasFocus) return kindColor ?? hopColor(1, 2);
  if (!kindColor) return hopColor(d.hop, maxHop);
  if (d.hop === Infinity || d.hop == null) return UNREACHABLE;
  const t = Math.min(d.hop / Math.max(maxHop, 1), 1);
  return d3.interpolateRgb(kindColor, nodeStroke())(t * 0.45);
}

/** Privileged roles and admin-consent permissions get the solid red signal ring. */
export function isDanger(d: GraphNode): boolean {
  return Boolean(d.data.is_privileged || d.data.admin_consent_app || d.data.admin_consent_delegated);
}

/** Activity-dot colour for the recent-change badge, or null when quiet. */
export function activityColor(changeCount: number): string | null {
  if (changeCount <= 0) return null;
  return changeCount <= 3 ? ACTIVITY : DANGER;
}
