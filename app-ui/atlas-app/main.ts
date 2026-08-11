// Graph Atlas MCP App — orchestrator. Architecture ported from EntraPulse
// Polyarchy: additive graph with a session cache, double-click context flips,
// search-driven focus, Reset that keeps the cache, and model-context updates
// so the assistant knows what the user is looking at.

import { App } from '@modelcontextprotocol/ext-apps';
import * as bridge from './bridge.js';
import * as store from './store/store.js';
import { initCanvas, render, centerOn } from './viz/canvas.js';
import { renderLegend } from './viz/legend.js';
import { initPanel, showPanel, hidePanel } from './ui/panel.js';
import { initSearch } from './ui/search.js';
import { initToolbar, getView, getEndpoint, getSince, setView, setEndpoint, setSince } from './ui/toolbar.js';
import type { Delta, EdgeKind, GraphNode, Seed, SearchResult, StoreSnapshot, ViewKind } from './types.js';

const $ = (id: string) => document.getElementById(id)!;

// ---------- status bar ----------

function setStatus(msg: string, isError = false) {
  const el = $('stat-msg');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

bridge.onToolCall((n) => ($('stat-api').textContent = `${n} tool calls`));

// ---------- graph merging ----------

/** Fold a server {nodes, edges} delta into the store. */
function mergeDelta(delta: Delta) {
  for (const n of delta.nodes ?? []) store.upsertNode({ hop: Infinity, expanded: false, ...n });
  for (const e of delta.edges ?? []) store.upsertEdge(e);
}

// ---------- model context ----------

function tellModel() {
  // Model-context updates are best-effort; never break the UI over them. The .catch
  // matters: hosts without ui/update-model-context support (e.g. MCP Jam) reject the
  // request with -32601, and an unhandled rejection surfaces as a host-visible error.
  try {
    const snap = store.snapshot();
    const focus = snap.nodes.find((n) => n.id === snap.focusId);
    void app
      .updateModelContext({
        structuredContent: {
          view: getView(),
          endpoint: getEndpoint(),
          focus: focus ? { id: focus.id, kind: focus.kind, label: focus.label } : null,
          nodes: snap.nodes.length,
          edges: snap.edges.length,
        },
      })
      .catch(() => {});
  } catch {
    // synchronous throw (e.g. not connected yet)
  }
}

// ---------- expansion (all dimensions go through the server) ----------

/**
 * Cache key for one node's expansion. Entity neighborhoods differ per endpoint;
 * entity expansions on the permission tab (touching permissions) and role tab
 * (permissions + granting roles) are their own dimensions; permissions and
 * roles expand the same way in every view.
 */
function expansionKey(node: GraphNode, view: ViewKind): string {
  if (node.kind === 'Permission') return 'permission';
  if (node.kind === 'Role') return 'role';
  if (view === 'entity') return `entity:${getEndpoint()}`;
  return view === 'role' ? 'entity-roles' : 'entity-usage';
}

/** Edge kinds a node's expansion produces — used to restore from cache. */
function expansionKinds(node: GraphNode, view: ViewKind): EdgeKind[] {
  if (node.kind === 'Permission') return ['touches', 'grants'];
  if (node.kind === 'Role') return ['grants'];
  return view === 'entity' ? ['navigation_property', 'inheritance'] : ['touches'];
}

function restoreFromCache(node: GraphNode, view: ViewKind): number {
  let restored = store.restoreExpansion(node.id, expansionKinds(node, view));
  // Two-hop expansions leave their second hop non-incident to the origin node —
  // replay it off the restored middle nodes: role -> perms -> entities, and (on
  // the role tab) entity -> perms -> granting roles.
  if (node.kind === 'Role') {
    for (const nb of store.neighbors(node.id)) {
      if (nb.kind === 'Permission') restored += store.restoreExpansion(nb.id, ['touches']);
    }
  } else if (node.kind === 'EntityType' && view === 'role') {
    for (const nb of store.neighbors(node.id)) {
      if (nb.kind === 'Permission') restored += store.restoreExpansion(nb.id, ['grants']);
    }
  }
  return restored;
}

async function expandNode(node: GraphNode) {
  const view = getView();
  const key = expansionKey(node, view);
  if (node.expandedIn?.has(key)) {
    // fetched earlier this session — rebuild from cache, no server round-trip
    const restored = restoreFromCache(node, view);
    store.computeHops(store.getFocusId());
    store.notify();
    if (restored) setStatus(`${node.label}: ${restored} relationship(s) from cache`);
    tellModel();
    return;
  }
  setStatus(`Expanding ${node.label}…`);
  try {
    const delta = await bridge.expand({
      node_id: node.id,
      kind: node.kind,
      view,
      endpoint: getEndpoint(),
      since: getSince(),
    });
    mergeDelta(delta);
    node.expanded = true;
    (node.expandedIn ??= new Set()).add(key);
    store.computeHops(store.getFocusId());
    store.notify();
    setStatus(delta.message ?? 'Expanded');
    tellModel();
  } catch (err) {
    console.error(err);
    setStatus((err as Error).message, true);
  }
}

/** Context flip: new focus, recompute hops, recolor, glide to center. */
function flipContext(node: GraphNode) {
  store.setFocus(node.id);
  centerOn(node.id, store.snapshot());
  expandNode(node); // served from cache when already fetched
}

/** Search pick: put the node on the canvas (cache-merged) and flip context to it. */
function loadAndFocus(result: SearchResult) {
  $('welcome').hidden = true;
  claimSpace();
  const node = store.upsertNode({
    hop: Infinity,
    expanded: false,
    id: result.id,
    kind: result.kind,
    label: result.label,
    data: {},
  });
  store.notify();
  flipContext(node);
}

function resetCanvas() {
  store.resetCanvas();
  hidePanel();
  $('welcome-msg').textContent =
    'Canvas cleared. Search above for an entity type, permission, or role — or ask the assistant ' +
    'to open a new view. Anything already explored reloads instantly from cache.';
  $('welcome').hidden = false;
  setStatus('Canvas cleared (cache kept)');
  tellModel();
}

async function loadHistory(node: GraphNode) {
  setStatus(`Loading ${node.label} history…`);
  try {
    const { total, events } = await bridge.timeline(node.id, { since: getSince() });
    node.timeline = { total, events };
    setStatus(`${node.label}: ${total} recorded change(s)`);
    showPanel(node, { isFocus: node.id === store.getFocusId() });
  } catch (err) {
    setStatus((err as Error).message, true);
  }
}

// ---------- UI wiring ----------

function onStoreChange(snapshot: StoreSnapshot) {
  render(snapshot);
  $('stat-nodes').textContent = `${snapshot.nodes.length} nodes`;
  $('stat-edges').textContent = `${snapshot.edges.length} edges`;

  const presentKinds = [...new Set(snapshot.edges.map((e) => e.kind))];
  const presentNodeKinds = [...new Set(snapshot.nodes.map((n) => n.kind))];
  renderLegend($('legend'), { presentKinds, presentNodeKinds });

  const sel = snapshot.nodes.find((n) => n.id === snapshot.selectedId);
  if (sel && !$('panel').hidden) {
    showPanel(sel, { isFocus: sel.id === snapshot.focusId });
  }
}

/** Tab/endpoint changes re-expand the focus when its new dimension isn't cached yet. */
function reExpandFocus() {
  const focus = store.getNode(store.getFocusId());
  if (focus && !focus.expandedIn?.has(expansionKey(focus, getView()))) expandNode(focus);
}

function initUi() {
  initCanvas($('canvas'), {
    onNodeClick: (node) => {
      store.setSelected(node.id);
      showPanel(node, { isFocus: node.id === store.getFocusId() });
    },
    onNodeDblClick: (node) => flipContext(node),
    onBackgroundClick: () => {
      store.setSelected(null);
      hidePanel();
    },
  });

  initPanel({
    onFocus: (node) => flipContext(node),
    onExpand: (node) => expandNode(node),
    onHistory: (node) => loadHistory(node),
    onClose: () => store.setSelected(null),
  });

  initToolbar({
    onViewChange: reExpandFocus,
    onEndpointChange: reExpandFocus,
    onSinceChange: () => setStatus('Change window updated — applies to new fetches'),
    onReset: resetCanvas,
  });
  initSearch(loadAndFocus);
  initExpandToggle();
  store.subscribe(onStoreChange);
}

// ---------- display mode ----------

const INLINE_HEIGHT = 600; // preferred inline height — enough room for the graph without dominating the chat

let spaceClaimed = false;
let lastReportedHeight = 0;

/**
 * The height to ask the host for. In fullscreen the host owns the surface, so
 * fill whatever it says it has. Inline (and pip), report our preference capped
 * by the host's constraint — never echo the granted height back: host-context
 * merges are partial, so containerDimensions can still hold a stale fullscreen
 * value right after a minimize/restore, and echoing it made the inline card
 * fullscreen-tall. The cap turns a stale value into a harmless upper bound.
 * A host bound is never clamped upward — a 300px slot gets a 300px report;
 * the stage's CSS min-height handles the visual degeneracy.
 */
function desiredHeight(): number {
  try {
    const ctx = app.getHostContext?.();
    const dims = ctx?.containerDimensions as { height?: number; maxHeight?: number } | undefined;
    const avail = dims?.height ?? dims?.maxHeight;
    const hasAvail = typeof avail === 'number' && Number.isFinite(avail) && avail > 0;
    if (ctx?.displayMode === 'fullscreen') {
      return hasAvail ? Math.floor(avail) : INLINE_HEIGHT;
    }
    return hasAvail ? Math.min(INLINE_HEIGHT, Math.floor(avail)) : INLINE_HEIGHT;
  } catch {
    // host context optional
  }
  return INLINE_HEIGHT;
}

/** Report our size — hosts that size the iframe off the app's reported height need
 *  this even when fullscreen was granted (Claude Desktop's app surface does). */
function reportSize() {
  let mode = 'inline';
  try {
    mode = app.getHostContext?.()?.displayMode ?? 'inline';
  } catch {
    // host context optional
  }
  // After the first report, stay quiet while fullscreen: the host owns geometry
  // there, and a fullscreen-height report would become the sticky height the
  // host restores to inline.
  if (mode === 'fullscreen' && lastReportedHeight) return;
  const h = desiredHeight();
  if (h === lastReportedHeight) return; // unchanged — don't ping-pong with the host
  lastReportedHeight = h;
  try {
    void app.sendSizeChanged({ height: h }).catch(() => {});
  } catch {
    // host-default size it is
  }
}

/**
 * Ask the host for fullscreen; if declined or unsupported, a tall inline frame
 * it is. Both are requests — hosts are free to ignore them. The size report is
 * unconditional: hosts that handle fullscreen themselves ignore it, hosts that
 * don't would otherwise leave the iframe at a tiny default height.
 */
async function claimSpace() {
  if (spaceClaimed) return;
  spaceClaimed = true;
  try {
    const ctx = app.getHostContext?.();
    const mode = ctx?.displayMode ?? 'inline';
    if (mode !== 'fullscreen' && ctx?.availableDisplayModes?.includes('fullscreen')) {
      await app.requestDisplayMode({ mode: 'fullscreen' });
    }
  } catch {
    // host without display-mode support
  }
  reportSize();
  syncExpandButton();
}

// The fullscreen claim above is one-shot, so once the user minimizes there'd be
// no way back to full canvas from inside the app — the toolbar toggle re-requests
// it (and hands the surface back). Starts hidden and shows only once the host
// advertises fullscreen (the SDK's gating pattern for requestDisplayMode);
// visibility is re-derived on every sync so a capability arriving in a later
// host-context update reveals it. A failed request hides it again.
function syncExpandButton(mode?: string) {
  const btn = $('expand-btn') as HTMLButtonElement;
  try {
    const ctx = app.getHostContext?.();
    btn.hidden = !ctx?.availableDisplayModes?.includes('fullscreen');
    const full = (mode ?? ctx?.displayMode) === 'fullscreen';
    btn.textContent = full ? 'Minimise' : 'Expand';
    btn.title = full ? 'Return to inline view' : 'Expand to fullscreen';
  } catch {
    btn.hidden = true; // no host context — no display-mode support to offer
  }
}

function initExpandToggle() {
  $('expand-btn').addEventListener('click', async () => {
    try {
      const target = app.getHostContext?.()?.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
      const result = await app.requestDisplayMode({ mode: target });
      syncExpandButton(result.mode);
    } catch {
      ($('expand-btn') as HTMLButtonElement).hidden = true; // host can't switch modes
    }
    reportSize();
  });
}

// ---------- host theme ----------

// The app owns its palette (dark default, light via data-theme) — the SVG colors
// are computed in JS, so a theme flip must also re-render the canvas.
function applyHostTheme(ctx: { theme?: string } | undefined) {
  const theme = ctx?.theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  if (store.snapshot().nodes.length) store.notify();
}

// ---------- MCP App bootstrap ----------

// Injected at bundle time from package.json by scripts/build-app-ui.js.
declare const __ATLAS_VERSION__: string;

// autoResize (default on) measures the document's natural height — useless for a
// full-height flex app; claimSpace() owns sizing instead.
const app = new App({ name: 'graph-atlas-app', version: __ATLAS_VERSION__ }, undefined, { autoResize: false });
bridge.setApp(app);

app.ontoolresult = (params) => {
  const sc = params?.structuredContent as Partial<Seed> | undefined;
  if (!sc) return;
  if (sc.atlas === 'opened') {
    $('welcome').hidden = true;
    claimSpace(); // fullscreen where supported, a tall inline frame otherwise
    if (sc.view) setView(sc.view);
    setEndpoint(sc.endpoint);
    mergeDelta(sc as Delta);
    if (sc.focusId) {
      const focusNode = store.getNode(sc.focusId);
      if (focusNode) {
        focusNode.expanded = true;
        (focusNode.expandedIn ??= new Set()).add(expansionKey(focusNode, sc.view ?? 'entity'));
      }
      store.setFocus(sc.focusId);
      // let the force layout place nodes before gliding to the focus
      setTimeout(() => centerOn(sc.focusId as string, store.snapshot()), 400);
      setStatus(sc.message ?? 'Loaded');
    } else {
      store.notify();
      setStatus(`${sc.message ?? 'Loaded'} — double-click a node to focus it`);
    }
    tellModel();
  } else if (sc.nodes) {
    // model-driven expansion delivered to the app
    mergeDelta(sc as Delta);
    store.computeHops(store.getFocusId());
    store.notify();
  }
};

app.ontoolinput = (params) => {
  // pre-sync the toolbar so the UI reflects the request before the result lands
  const args = params.arguments as { view?: ViewKind; endpoint?: string; since?: string } | undefined;
  if (args?.view) setView(args.view);
  setEndpoint(args?.endpoint);
  setSince(args?.since);
};

app.onhostcontextchanged = (params) => {
  applyHostTheme((params as { hostContext?: { theme?: string } })?.hostContext ?? (params as { theme?: string }));
  // container dimensions / display mode may have changed — keep our height in step
  if (spaceClaimed) reportSize();
  syncExpandButton();
};

initUi();

app
  .connect()
  .then(() => {
    try {
      applyHostTheme(app.getHostContext?.());
    } catch {
      /* host context optional */
    }
    syncExpandButton();
  })
  .catch((err) => {
    console.error(err);
    $('welcome-msg').textContent = 'Could not connect to the MCP host. This app must run inside an MCP Apps-capable client.';
  });
