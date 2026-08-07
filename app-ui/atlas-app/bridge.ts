// Every data need becomes a tools/call to the graph-atlas server via the MCP
// Apps host bridge (ported from EntraPulse Polyarchy's bridge.js).

import type { App } from '@modelcontextprotocol/ext-apps';
import type { Delta, NodeKind, SearchResult, TimelineEvent } from './types.js';

let app: App | null = null;
let toolCalls = 0;
const countListeners = new Set<(n: number) => void>();

export function setApp(a: App) {
  app = a;
}

export function onToolCall(fn: (n: number) => void) {
  countListeners.add(fn);
}

/**
 * Fallback for hosts that strip structuredContent: the server's text block carries the
 * delta as fenced JSON with flattened nodes ({id, kind, label, ...data}) — re-nest them.
 */
function parseFencedDelta(text: string | undefined): Record<string, unknown> | null {
  const m = text?.match(/```json\n([\s\S]*?)\n```/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    if (Array.isArray(parsed.nodes)) {
      parsed.nodes = parsed.nodes.map(({ id, kind, label, ...data }: Record<string, unknown>) => ({ id, kind, label, data }));
    }
    return parsed;
  } catch {
    return null;
  }
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  toolCalls++;
  countListeners.forEach((fn) => fn(toolCalls));
  const result = await app!.callServerTool({
    name,
    arguments: args,
    _meta: { 'atlas/origin': 'app' },
  });
  const text = result.content?.find((c) => c.type === 'text')?.text;
  if (result.isError) {
    throw new Error(text ?? `${name} failed`);
  }
  return (result.structuredContent ?? parseFencedDelta(text) ?? {}) as T;
}

/** One call per double-click/Expand — returns a {nodes, edges, message} delta. */
export function expand(args: { node_id: string; kind: NodeKind; view: string; endpoint: string; since?: string }): Promise<Delta> {
  return call<Delta>('expand_schema_node', args);
}

export async function search(query: string): Promise<SearchResult[]> {
  const { results } = await call<{ results?: SearchResult[] }>('search_schema_objects', { query });
  return results ?? [];
}

export async function timeline(nodeId: string, opts: { endpoint?: string; since?: string } = {}): Promise<{ total: number; events: TimelineEvent[] }> {
  const { total, events } = await call<{ total?: number; events?: TimelineEvent[] }>('get_node_timeline', { node_id: nodeId, ...opts });
  return { total: total ?? 0, events: events ?? [] };
}
