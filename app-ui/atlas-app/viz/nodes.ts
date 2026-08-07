import * as d3 from 'd3';
import { activityColor, DANGER, isDanger, isLightTheme, nodeFill, nodeStroke, UNREACHABLE } from './colors.js';
import type { GraphNode, NodeKind } from '../types.js';

// Fluent-style icon paths, 24x24 viewBox, one <symbol> per node kind:
// database cylinder (entity type), key (permission), shield-person (role).
const ICONS: Record<NodeKind, string> = {
  EntityType:
    'M12 3c4.42 0 8 1.34 8 3v12c0 1.66-3.58 3-8 3s-8-1.34-8-3V6c0-1.66 3.58-3 8-3Zm6 10.5c-1.47.9-3.66 1.5-6 1.5s-4.53-.6-6-1.5V18c0 .55 2.24 1.5 6 1.5s6-.95 6-1.5v-4.5Zm0-5c-1.47.9-3.66 1.5-6 1.5s-4.53-.6-6-1.5V13c0 .55 2.24 1.5 6 1.5s6-.95 6-1.5V8.5ZM12 4.5c-3.76 0-6 .95-6 1.5s2.24 1.5 6 1.5 6-.95 6-1.5-2.24-1.5-6-1.5Z',
  Permission:
    'M15.5 2a6.5 6.5 0 0 1 6.5 6.5 6.5 6.5 0 0 1-8.42 6.21l-1.83 1.83H9.5v2.25H7.25v2.25H3a1 1 0 0 1-1-1v-2.84a1 1 0 0 1 .29-.7l7-7A6.5 6.5 0 0 1 15.5 2Zm1 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  Role: 'M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5l8-3Zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM12 13c-2.5 0-4.5 1.2-4.5 2.7v.8c1.2 1.6 2.8 2.8 4.5 3.4 1.7-.6 3.3-1.8 4.5-3.4v-.8c0-1.5-2-2.7-4.5-2.7Z',
};

export const NODE_RADIUS: Record<NodeKind, number> = { EntityType: 16, Permission: 17, Role: 18 };

export function radiusOf(node: GraphNode, isFocus: boolean): number {
  return (NODE_RADIUS[node.kind] ?? 16) * (isFocus ? 1.45 : 1);
}

/** Install per-kind <symbol> icons. */
export function installDefs(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>) {
  const defs = svg.append('defs');
  for (const [kind, path] of Object.entries(ICONS)) {
    defs.append('symbol').attr('id', `icon-${kind}`).attr('viewBox', '0 0 24 24').append('path').attr('d', path);
  }
}

function iconContrast(fill: string): string {
  if (fill === UNREACHABLE) return '#dce3ee';
  return d3.hcl(fill).l > 60 ? '#132036' : isLightTheme() ? '#f2f6fc' : '#dce3ee';
}

/**
 * Render/update node visuals inside each node <g>. Called on every store
 * change; rebuilds the glyph so hop recolors and theme flips apply.
 */
export function drawNode(
  selection: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>,
  { focusId, maxHop, hasFocus }: { focusId: string | null; maxHop: number; hasFocus: boolean },
) {
  selection.each(function (d) {
    const g = d3.select(this);
    const isFocus = d.id === focusId;
    const r = radiusOf(d, isFocus);
    const fill = nodeFill(d, maxHop, hasFocus);

    g.selectAll('*').remove();

    // dashed accent focus ring
    if (isFocus) {
      g.append('circle')
        .attr('class', 'focus-ring')
        .attr('r', r + 5)
        .attr('fill', 'none')
        .attr('stroke', '#4f8ef7')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '3 3');
    }

    // solid red signal ring — privileged role / admin-consent permission
    if (isDanger(d)) {
      g.append('circle')
        .attr('class', 'danger-ring')
        .attr('r', r + 3)
        .attr('fill', 'none')
        .attr('stroke', DANGER)
        .attr('stroke-width', 2);
    }

    g.append('circle')
      .attr('r', r)
      .attr('fill', fill)
      .attr('stroke', isFocus ? '#4f8ef7' : nodeStroke())
      .attr('stroke-width', 1.5);

    const s = r * 1.15;
    g.append('use')
      .attr('href', `#icon-${d.kind}`)
      .attr('x', -s / 2)
      .attr('y', -s / 2)
      .attr('width', s)
      .attr('height', s)
      .attr('fill', iconContrast(fill));

    // recent-change activity dot at the node's top-right
    const activity = activityColor(Number(d.data.change_count ?? 0));
    if (activity) {
      g.append('circle')
        .attr('class', 'activity-dot')
        .attr('cx', r * 0.7)
        .attr('cy', -r * 0.7)
        .attr('r', 4)
        .attr('fill', activity)
        .attr('stroke', nodeStroke())
        .attr('stroke-width', 1);
    }

    g.append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('y', r + 13)
      .text(d.label.length > 24 ? d.label.slice(0, 23) + '…' : d.label);
  });
}
