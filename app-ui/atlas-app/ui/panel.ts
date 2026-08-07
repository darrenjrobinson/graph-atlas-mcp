// The detail card — imperative, textContent-only DOM (server data is never
// interpolated into HTML). Fields come from per-kind declarative tables reading
// the node's data bag; rows with null/empty values are skipped.

import { NODE_KIND_LABELS } from '../viz/colors.js';
import type { GraphNode, NodeKind, TimelineEvent } from '../types.js';

type FieldFormat = (value: unknown) => string;

const yesNo: FieldFormat = (v) => (v ? 'Yes' : 'No');
const requiredOrNot: FieldFormat = (v) => (v ? 'Required' : 'Not required');
const plain: FieldFormat = (v) => String(v);

const FIELDS: Record<NodeKind, Array<[string, string, FieldFormat?]>> = {
  EntityType: [
    ['base_type', 'Inherits'],
    ['property_count', 'Properties'],
    ['navigation_property_count', 'Navigation properties'],
    ['change_count', 'Recent changes'],
    ['endpoint', 'Endpoint'],
  ],
  Permission: [
    ['admin_consent_app', 'Admin consent (application)', requiredOrNot],
    ['admin_consent_delegated', 'Admin consent (delegated)', requiredOrNot],
    ['resource_count', 'Touches (entity types)'],
  ],
  Role: [
    ['is_privileged', 'Privileged', yesNo],
    ['blast_radius', 'Blast radius (entity types)'],
    ['action_count', 'Published RBAC actions', (v) => (v === 0 ? 'None — managed outside Entra' : String(v))],
    ['template_id', 'Template ID'],
  ],
};

interface PanelCallbacks {
  onFocus?: (node: GraphNode) => void;
  onExpand?: (node: GraphNode) => void;
  onHistory?: (node: GraphNode) => void;
  onClose?: () => void;
}

let panelEl: HTMLElement;
let contentEl: HTMLElement;
let actions: PanelCallbacks = {};

export function initPanel(cb: PanelCallbacks) {
  actions = cb;
  panelEl = document.getElementById('panel')!;
  contentEl = document.getElementById('panel-content')!;
  document.getElementById('panel-close')!.addEventListener('click', () => {
    hidePanel();
    actions.onClose?.();
  });
}

export function hidePanel() {
  panelEl.hidden = true;
}

function badge(text: string, danger: boolean): HTMLSpanElement {
  const b = document.createElement('span');
  b.className = danger ? 'badge danger' : 'badge';
  b.textContent = text;
  return b;
}

export function showPanel(node: GraphNode, { isFocus }: { isFocus: boolean }) {
  contentEl.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'panel-head';

  const av = document.createElement('div');
  av.className = 'panel-avatar initials';
  av.textContent = '⬡';
  head.appendChild(av);

  const title = document.createElement('div');
  title.className = 'panel-title';
  const h2 = document.createElement('h2');
  h2.textContent = node.label;
  if (node.kind === 'Role' && node.data.is_privileged) {
    h2.appendChild(badge('Privileged', true));
  }
  if (node.kind === 'Permission' && (node.data.admin_consent_app || node.data.admin_consent_delegated)) {
    h2.appendChild(badge('Admin consent', true));
  }
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = NODE_KIND_LABELS[node.kind] ?? node.kind;
  title.append(h2, sub);
  head.appendChild(title);
  contentEl.appendChild(head);

  const hopLine = document.createElement('div');
  hopLine.className = 'sub';
  hopLine.textContent =
    node.hop === 0
      ? 'This is the focus'
      : node.hop === Infinity || node.hop === undefined
        ? 'Not connected to focus'
        : `${node.hop} hop${node.hop > 1 ? 's' : ''} from focus`;
  contentEl.appendChild(hopLine);

  const btns = document.createElement('div');
  btns.className = 'panel-actions';
  if (!isFocus) {
    const focusBtn = document.createElement('button');
    focusBtn.className = 'primary';
    focusBtn.textContent = 'Set as focus';
    focusBtn.addEventListener('click', () => actions.onFocus?.(node));
    btns.appendChild(focusBtn);
  }
  const expandBtn = document.createElement('button');
  expandBtn.className = 'ghost';
  expandBtn.textContent = node.expanded ? 'Re-expand' : 'Expand';
  expandBtn.addEventListener('click', () => actions.onExpand?.(node));
  btns.appendChild(expandBtn);
  if (node.kind === 'EntityType' && !node.timeline) {
    const historyBtn = document.createElement('button');
    historyBtn.className = 'ghost';
    historyBtn.textContent = 'History';
    historyBtn.addEventListener('click', () => actions.onHistory?.(node));
    btns.appendChild(historyBtn);
  }
  contentEl.appendChild(btns);

  const dl = document.createElement('dl');
  dl.className = 'panel-attrs';
  for (const [key, label, format] of FIELDS[node.kind]) {
    const val = node.data[key];
    if (val == null || val === '') continue;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = (format ?? plain)(val);
    dl.append(dt, dd);
  }
  if (dl.childElementCount) contentEl.appendChild(dl);

  if (typeof node.data.description === 'string' && node.data.description) {
    const p = document.createElement('p');
    p.className = 'sub';
    p.textContent = node.data.description;
    contentEl.appendChild(p);
  }

  if (node.timeline) renderTimeline(node.timeline.events, node.timeline.total);

  panelEl.hidden = false;
}

/** Append the change timeline below the fields (fetched lazily via get_node_timeline). */
export function renderTimeline(events: TimelineEvent[], total: number) {
  const heading = document.createElement('div');
  heading.className = 'timeline-heading';
  heading.textContent = `Change history (${events.length} of ${total})`;
  contentEl.appendChild(heading);

  const ul = document.createElement('ul');
  ul.className = 'timeline';
  for (const ev of events) {
    const li = document.createElement('li');
    const date = document.createElement('div');
    date.className = 't-date';
    date.textContent = `${ev.snapshot_date} · ${ev.endpoint}`;
    const desc = document.createElement('div');
    desc.className = 't-desc';
    const kind = document.createElement('span');
    kind.className = 't-kind';
    kind.textContent = ev.change_kind;
    desc.appendChild(kind);
    desc.appendChild(document.createTextNode(` ${ev.property_name ?? ''}${ev.description ? ` — ${ev.description}` : ''}`));
    li.append(date, desc);
    ul.appendChild(li);
  }
  contentEl.appendChild(ul);
}
