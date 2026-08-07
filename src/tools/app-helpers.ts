import type { Delta } from '../schema-graph.js';

/**
 * Result helpers shared by the MCP App tools. Node ids/labels are rendered into the
 * text block, not just structuredContent, because not every MCP client shows the
 * model the latter (pattern from EntraPulse Polyarchy).
 */
export function ok(text: string, structuredContent: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text }], structuredContent };
}

export function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

/** Delta rendered for the text block: message plus compact node/edge JSON. */
export function deltaText(delta: Delta): string {
  const nodes = delta.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, ...n.data }));
  const edges = delta.edges.map(({ source, kind, target, label }) => ({ source, kind, target, label }));
  return `${delta.message}\n\`\`\`json\n${JSON.stringify({ nodes, edges })}\n\`\`\``;
}
