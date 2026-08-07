// View tabs (Entity / Permission / Role), the endpoint + change-window pickers,
// and the Reset button.

import type { ViewKind } from '../types.js';

interface ToolbarCallbacks {
  onViewChange?: (view: ViewKind) => void;
  onEndpointChange?: () => void;
  onSinceChange?: () => void;
  onReset?: () => void;
}

let currentView: ViewKind = 'entity';
let tabs: NodeListOf<HTMLButtonElement>;
let endpointSelect: HTMLSelectElement;
let sinceSelect: HTMLSelectElement;
let callbacks: ToolbarCallbacks = {};

function applyView(view: ViewKind) {
  currentView = view;
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  // the endpoint only matters for entity-view schema neighborhoods
  endpointSelect.hidden = view !== 'entity';
}

export function initToolbar(cb: ToolbarCallbacks) {
  callbacks = cb;
  tabs = document.querySelectorAll<HTMLButtonElement>('#view-tabs .tab');
  endpointSelect = document.getElementById('endpoint-select') as HTMLSelectElement;
  sinceSelect = document.getElementById('since-select') as HTMLSelectElement;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view as ViewKind;
      if (tab.disabled || view === currentView) return;
      applyView(view);
      callbacks.onViewChange?.(view);
    });
  });

  endpointSelect.addEventListener('change', () => callbacks.onEndpointChange?.());
  sinceSelect.addEventListener('change', () => callbacks.onSinceChange?.());
  document.getElementById('reset-btn')!.addEventListener('click', () => callbacks.onReset?.());

  applyView(currentView);
}

/** Sync from the host (ontoolinput / seed) without firing callbacks. */
export function setView(view: ViewKind) {
  if (view !== currentView) applyView(view);
}

export function setEndpoint(endpoint: string | null | undefined) {
  if (endpoint === 'v1.0' || endpoint === 'beta') endpointSelect.value = endpoint;
}

export function setSince(since: string | undefined) {
  if (since && [...sinceSelect.options].some((o) => o.value === since)) sinceSelect.value = since;
}

export function getView(): ViewKind {
  return currentView;
}

export function getEndpoint(): 'v1.0' | 'beta' {
  return endpointSelect.value as 'v1.0' | 'beta';
}

/**
 * The change-activity window as an ISO date — the server compares snapshot_date
 * lexicographically, so day counts must be converted here ("30" would silently
 * match nothing).
 */
export function getSince(): string {
  const v = sinceSelect.value;
  if (v === 'all') return '2000-01-01';
  return new Date(Date.now() - Number(v) * 86_400_000).toISOString().slice(0, 10);
}
