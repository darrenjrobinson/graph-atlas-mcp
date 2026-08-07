import { search } from '../bridge.js';
import type { SearchResult } from '../types.js';

let timer: ReturnType<typeof setTimeout> | null = null;
let lastTerm = '';

export function initSearch(onPick: (result: SearchResult) => void) {
  const input = document.getElementById('search-input') as HTMLInputElement;
  const results = document.getElementById('search-results') as HTMLUListElement;

  input.disabled = false;

  input.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    const term = input.value.trim();
    if (term.length < 2) {
      results.hidden = true;
      return;
    }
    timer = setTimeout(async () => {
      lastTerm = term;
      try {
        const hits = await search(term);
        if (term !== lastTerm) return; // stale response
        renderResults(results, hits, (r) => {
          results.hidden = true;
          input.value = '';
          onPick(r);
        });
      } catch {
        renderResults(results, [], () => {});
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#search-box')) results.hidden = true;
  });
}

function renderResults(el: HTMLUListElement, hits: SearchResult[], onPick: (r: SearchResult) => void) {
  el.innerHTML = '';
  if (!hits.length) {
    const li = document.createElement('li');
    li.className = 'r-empty';
    li.textContent = 'No matches';
    el.appendChild(li);
  }
  for (const r of hits) {
    const li = document.createElement('li');
    const name = document.createElement('div');
    name.className = 'r-name';
    name.textContent = r.label;
    const sub = document.createElement('div');
    sub.className = 'r-sub';
    sub.textContent = r.sub;
    li.append(name, sub);
    li.addEventListener('click', () => onPick(r));
    el.appendChild(li);
  }
  el.hidden = false;
}
