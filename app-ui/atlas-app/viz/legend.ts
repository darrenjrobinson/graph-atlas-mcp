import { edgeColor, EDGE_LABELS, NODE_KIND_LABELS, hopRamp, hopColor, nodeKindColor, DANGER, ACTIVITY } from './colors.js';
import { setFilters } from './canvas.js';
import type { EdgeKind, NodeKind } from '../types.js';

// checked = visible; hidden kinds accumulate into these sets (they survive
// legend rebuilds, so rows must read them back when re-rendered)
const hiddenEdgeKinds = new Set<EdgeKind>();
const hiddenNodeKinds = new Set<NodeKind>();

function pushFilters() {
  setFilters({ edgeKinds: hiddenEdgeKinds, nodeKinds: hiddenNodeKinds });
}

function row(
  container: HTMLElement,
  { swatchColor, round, label, checked, onToggle }: { swatchColor: string; round?: boolean; label: string; checked: boolean; onToggle: (hidden: boolean) => void },
) {
  const lab = document.createElement('label');

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = checked;
  cb.addEventListener('change', () => onToggle(!cb.checked));

  const sw = document.createElement('span');
  sw.className = 'swatch' + (round ? ' round' : '');
  sw.style.background = swatchColor;

  lab.append(cb, sw, document.createTextNode(label));
  container.appendChild(lab);
}

function signalRow(container: HTMLElement, swatch: HTMLElement, label: string) {
  const lab = document.createElement('label');
  lab.style.cursor = 'default';
  lab.append(swatch, document.createTextNode(label));
  container.appendChild(lab);
}

function heading(container: HTMLElement, text: string) {
  const h = document.createElement('h3');
  h.textContent = text;
  container.appendChild(h);
}

/**
 * Build the legend. `presentKinds`/`presentNodeKinds` limit rows to what's
 * actually on screen; call again as new dimensions appear.
 */
export function renderLegend(el: HTMLElement, { presentKinds, presentNodeKinds }: { presentKinds: EdgeKind[]; presentNodeKinds: NodeKind[] }) {
  el.innerHTML = '';

  heading(el, 'Relationships');
  for (const kind of presentKinds) {
    row(el, {
      swatchColor: edgeColor(kind),
      label: EDGE_LABELS[kind] ?? kind,
      checked: !hiddenEdgeKinds.has(kind),
      onToggle: (hidden) => {
        hidden ? hiddenEdgeKinds.add(kind) : hiddenEdgeKinds.delete(kind);
        pushFilters();
      },
    });
  }

  if (presentNodeKinds.length > 1) {
    heading(el, 'Object types');
    for (const kind of presentNodeKinds) {
      row(el, {
        // entity types show the mid-ramp blue; permissions/roles wear their edge colour
        swatchColor: nodeKindColor(kind) ?? hopColor(1, 2),
        round: true,
        label: NODE_KIND_LABELS[kind] ?? kind,
        checked: !hiddenNodeKinds.has(kind),
        onToggle: (hidden) => {
          hidden ? hiddenNodeKinds.add(kind) : hiddenNodeKinds.delete(kind);
          pushFilters();
        },
      });
    }
  }

  heading(el, 'Distance from focus');
  const ramp = document.createElement('div');
  ramp.className = 'hop-ramp';
  const near = document.createElement('span');
  near.className = 'lbl';
  near.textContent = 'focus';
  ramp.appendChild(near);
  for (const c of hopRamp(5)) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.background = c;
    ramp.appendChild(chip);
  }
  const far = document.createElement('span');
  far.className = 'lbl';
  far.textContent = 'far';
  ramp.appendChild(far);
  el.appendChild(ramp);

  heading(el, 'Signals');
  const ring = document.createElement('span');
  ring.className = 'swatch ring';
  ring.style.borderColor = DANGER;
  signalRow(el, ring, 'Privileged / admin consent');
  const dot = document.createElement('span');
  dot.className = 'swatch dot';
  dot.style.background = ACTIVITY;
  signalRow(el, dot, 'Recent changes');
}
