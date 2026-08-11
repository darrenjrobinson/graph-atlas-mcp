// d3 force-directed SVG canvas, ported from EntraPulse Polyarchy — including its
// hard-won interaction fixes: manual double-click detection (native dblclick is
// unreliable in host iframes), reheat-only-on-structural-change (so selection and
// theme re-renders never scatter the layout), and drag that only heats the
// simulation once real movement starts.

import * as d3 from 'd3';
import { edgeColor } from './colors.js';
import { installDefs, drawNode, radiusOf } from './nodes.js';
import type { EdgeKind, GraphEdge, GraphNode, NodeKind, StoreSnapshot } from '../types.js';

const LINK_DISTANCE: Record<EdgeKind, number> = {
  navigation_property: 90,
  inheritance: 70,
  grants: 110,
  touches: 100,
};

interface CanvasCallbacks {
  onNodeClick?: (node: GraphNode) => void;
  onNodeDblClick?: (node: GraphNode) => void;
  onBackgroundClick?: () => void;
}

let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
let viewport: d3.Selection<SVGGElement, unknown, null, undefined>;
let edgeLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
let nodeLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
let simulation: d3.Simulation<GraphNode, GraphEdge>;
let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown>;
let handlers: CanvasCallbacks = {};
let lastNodeCount = 0;
let lastEdgeCount = 0;
let lastClick: { id: string | null; t: number } = { id: null, t: 0 };
let lastCenterId: string | null = null; // last programmatic center target
let lastFitSize = { w: 0, h: 0 }; // rect size at the last successful fit
let userAdjusted = false; // user panned/zoomed since our last fit

const DBLCLICK_MS = 450;
let currentFilters: { edgeKinds: Set<EdgeKind>; nodeKinds: Set<NodeKind> } = {
  edgeKinds: new Set(),
  nodeKinds: new Set(),
}; // sets = hidden

export function initCanvas(container: HTMLElement, callbacks: CanvasCallbacks = {}) {
  handlers = callbacks;

  svg = d3.select(container).append('svg').attr('width', '100%').attr('height', '100%');

  installDefs(svg);

  viewport = svg.append('g').attr('class', 'viewport');
  edgeLayer = viewport.append('g').attr('class', 'edges');
  nodeLayer = viewport.append('g').attr('class', 'nodes');

  zoomBehavior = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.15, 4])
    .on('zoom', (event) => {
      if (event.sourceEvent) userAdjusted = true; // real gesture, not our own transition
      viewport.attr('transform', event.transform);
    });

  svg.call(zoomBehavior).on('dblclick.zoom', null);
  svg.on('click', (event) => {
    if (event.target === svg.node()) handlers.onBackgroundClick?.();
  });

  simulation = d3
    .forceSimulation<GraphNode>()
    .force(
      'link',
      d3
        .forceLink<GraphNode, GraphEdge>()
        .id((d) => d.id)
        .distance((l) => LINK_DISTANCE[l.kind] ?? 100),
    )
    .force('charge', d3.forceManyBody().strength(-300))
    .force('collide', d3.forceCollide<GraphNode>().radius((d) => radiusOf(d, false) + 14))
    .force('x', d3.forceX().strength(0.03))
    .force('y', d3.forceY().strength(0.03))
    .on('tick', tick);

  // d3's timer runs on requestAnimationFrame, which browsers freeze for hidden
  // iframes — a graph seeded while the host has the widget hidden (e.g. MCP Jam's
  // Data tab) never gets laid out. Kick the simulation whenever the canvas
  // becomes visible again; restart() resumes the timer without touching alpha,
  // and the small alpha floor spreads anything that never got a first tick.
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && simulation.nodes().length) {
        simulation.alpha(Math.max(simulation.alpha(), 0.3)).restart();
        if (lastFitSize.w < 10) refit(); // a fit deferred while hidden — finish it now
      }
    }).observe(container);
  }

  // centerOn() measures the container exactly once, so a fit computed against a
  // hidden (0×0) iframe pins the graph top-left, and a host that reshapes the
  // container later (minimize/restore, panel resize) leaves the focus off-center.
  // Watch real geometry and re-fit — but never report sizes from here: our report
  // sets the iframe size this observer measures, which would be a feedback loop.
  if (typeof ResizeObserver === 'function') {
    let raf = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const { width, height } = container.getBoundingClientRect();
        if (width < 10 || height < 10) return;
        if (lastFitSize.w < 10 || lastFitSize.h < 10) {
          // first real size after a hidden/collapsed start — the earlier fit was
          // computed against nothing; redo it and spread anything unlaid-out
          if (simulation.nodes().length) simulation.alpha(Math.max(simulation.alpha(), 0.3)).restart();
          refit();
        } else if (!userAdjusted && (Math.abs(width - lastFitSize.w) > 24 || Math.abs(height - lastFitSize.h) > 24)) {
          refit(); // container reshaped materially — keep the focus centered
        }
      });
    }).observe(container);
  }
}

/**
 * Give never-positioned nodes a starting spot next to a positioned neighbor
 * (or the focus), instead of d3's default spiral around the global origin —
 * expansions bloom out of the node they came from, and a node can never
 * render without coordinates even if the simulation is frozen.
 */
function placeNewNodes(nodes: GraphNode[], edges: GraphEdge[], focusId: string | null) {
  const positioned = new Map<string, GraphNode>();
  for (const n of nodes) {
    if (Number.isFinite(n.x) && Number.isFinite(n.y)) positioned.set(n.id, n);
  }
  const idOf = (e: string | GraphNode) => (typeof e === 'object' ? e.id : e);
  const focus = focusId ? positioned.get(focusId) : undefined;
  for (const n of nodes) {
    if (positioned.has(n.id)) continue;
    let anchor = focus;
    for (const e of edges) {
      const src = idOf(e.source);
      const tgt = idOf(e.target);
      if (src === n.id && positioned.has(tgt)) anchor = positioned.get(tgt);
      else if (tgt === n.id && positioned.has(src)) anchor = positioned.get(src);
      if (anchor && anchor !== focus) break;
    }
    const angle = Math.random() * 2 * Math.PI;
    const radius = 40 + Math.random() * 50;
    n.x = (anchor?.x ?? 0) + Math.cos(angle) * radius;
    n.y = (anchor?.y ?? 0) + Math.sin(angle) * radius;
    positioned.set(n.id, n);
  }
}

function tick() {
  edgeLayer
    .selectAll<SVGLineElement, GraphEdge>('line')
    .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
    .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
    .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
    .attr('y2', (d) => (d.target as GraphNode).y ?? 0);
  nodeLayer.selectAll<SVGGElement, GraphNode>('g.node').attr('transform', (d) => `translate(${d.x},${d.y})`);
}

function dragBehavior() {
  // Heat the simulation only once real movement starts — a bare mousedown
  // (e.g. the first press of a double-click) must not shuffle the graph.
  let heated = false;
  return d3
    .drag<SVGGElement, GraphNode>()
    .clickDistance(4)
    .on('start', (event, d) => {
      heated = false;
      d.fx = d.x;
      d.fy = d.y;
    })
    .on('drag', (event, d) => {
      if (!heated) {
        heated = true;
        if (!event.active) simulation.alphaTarget(0.3).restart();
      }
      d.fx = event.x;
      d.fy = event.y;
    })
    .on('end', (event, d) => {
      if (heated && !event.active) simulation.alphaTarget(0);
      // A real drag pins the node where it was dropped — the point of dragging is
      // to rearrange the layout, and releasing it back to the simulation would
      // just spring it home. A plain press (no movement) releases as before.
      if (!heated) {
        d.fx = null;
        d.fy = null;
      }
    });
}

export function setFilters(filters: { edgeKinds: Set<EdgeKind>; nodeKinds: Set<NodeKind> }) {
  currentFilters = filters;
  applyFilters();
}

function applyFilters() {
  const { edgeKinds, nodeKinds } = currentFilters;
  const kindOf = (endpoint: string | GraphNode): NodeKind | '' => (typeof endpoint === 'object' ? endpoint.kind : '');
  nodeLayer.selectAll<SVGGElement, GraphNode>('g.node').classed('dim', (d) => nodeKinds.has(d.kind));
  edgeLayer
    .selectAll<SVGLineElement, GraphEdge>('line')
    .classed('dim', (d) => edgeKinds.has(d.kind) || nodeKinds.has(kindOf(d.source) as NodeKind) || nodeKinds.has(kindOf(d.target) as NodeKind));
}

/** Re-join the store snapshot into the SVG and reheat the simulation. */
export function render(snapshot: StoreSnapshot) {
  const { nodes, edges, focusId } = snapshot;
  const hasFocus = focusId != null;
  const maxHop = nodes.reduce((m, n) => (n.hop !== Infinity && n.hop !== undefined && n.hop > m ? n.hop : m), 1);

  edgeLayer
    .selectAll<SVGLineElement, GraphEdge>('line')
    .data(edges, (d) => d.id)
    .join('line')
    .attr('class', 'edge')
    .attr('stroke', (d) => edgeColor(d.kind))
    .attr('stroke-width', 1.5);

  nodeLayer
    .selectAll<SVGGElement, GraphNode>('g.node')
    .data(nodes, (d) => d.id)
    .join(
      (enter) => {
        const g = enter.append('g').attr('class', 'node');
        g.call(dragBehavior());
        // Double-click is detected from two clicks on the same node rather
        // than the native dblclick event — the native event needs both clicks
        // to land on the same pixel-stable element, which host iframes and
        // node drift make unreliable.
        g.on('click', (event: PointerEvent, d) => {
          event.stopPropagation();
          handlers.onNodeClick?.(d);
          if (lastClick.id === d.id && event.timeStamp - lastClick.t < DBLCLICK_MS) {
            lastClick = { id: null, t: 0 };
            handlers.onNodeDblClick?.(d);
          } else {
            lastClick = { id: d.id, t: event.timeStamp };
          }
        });
        g.on('dblclick', (event: Event) => event.stopPropagation());
        return g;
      },
      (update) => update,
      (exit) => exit.remove(),
    )
    .classed('focus', (d) => d.id === focusId)
    .classed('selected', (d) => d.id === snapshot.selectedId)
    .call(drawNode, { focusId, maxHop, hasFocus });

  // Reheat only on structural change — selection/focus/theme re-renders
  // must leave positions alone or a double-click's first click scatters the
  // graph before the second click lands. Counts suffice: nodes/edges are only
  // ever added (or wiped by reset), never swapped one-for-one.
  if (nodes.length !== lastNodeCount || edges.length !== lastEdgeCount) {
    lastNodeCount = nodes.length;
    lastEdgeCount = edges.length;
    placeNewNodes(nodes, edges, focusId);
    simulation.nodes(nodes);
    (simulation.force('link') as d3.ForceLink<GraphNode, GraphEdge>).links(edges);
    simulation.alpha(0.5).restart();
    tick(); // position everything immediately — never render a frame without transforms
  }

  applyFilters();
}

/**
 * Smoothly pan/zoom so the given node is centered (context flip). Resets the
 * zoom to scale 1. Against a hidden/collapsed container the fit is deferred:
 * the target is remembered and the resize/visibility observers finish the job
 * once the canvas has real dimensions.
 */
export function centerOn(nodeId: string, snapshot: StoreSnapshot) {
  lastCenterId = nodeId;
  const node = snapshot.nodes.find((n) => n.id === nodeId);
  if (!node || node.x == null) return;
  const { width, height } = (svg.node() as SVGSVGElement).getBoundingClientRect();
  if (width < 10 || height < 10) return;
  userAdjusted = false;
  lastFitSize = { w: width, h: height };
  const t = d3.zoomIdentity.translate(width / 2 - node.x, height / 2 - (node.y ?? 0));
  svg.transition().duration(600).call(zoomBehavior.transform, t);
}

/** Re-center the last center target at the current zoom scale — used when the
 *  container changes shape, so unlike centerOn it must not reset the zoom. */
function refit() {
  if (!lastCenterId) return;
  const { width, height } = (svg.node() as SVGSVGElement).getBoundingClientRect();
  if (width < 10 || height < 10) return;
  const node = simulation.nodes().find((n) => n.id === lastCenterId);
  if (!node || node.x == null) return;
  userAdjusted = false;
  lastFitSize = { w: width, h: height };
  const k = d3.zoomTransform(svg.node() as SVGSVGElement).k;
  const t = d3.zoomIdentity.translate(width / 2 - k * node.x, height / 2 - k * (node.y ?? 0)).scale(k);
  svg.transition().duration(200).call(zoomBehavior.transform, t);
}
