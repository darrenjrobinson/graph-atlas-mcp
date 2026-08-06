import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

export interface ChangeRow {
  id: number;
  detected_at: string;
  endpoint: string;
  object_type: string | null;
  object_name: string | null;
  property_name: string | null;
  change_kind: string;
  change_target: string | null;
  old_value: string | null;
  new_value: string | null;
  old_type: string | null;
  new_type: string | null;
  description: string | null;
  raw_diff: string | null;
  snapshot_date: string;
  source: string;
}

const STOPWORDS = new Set(['the', 'a', 'an', 'to', 'for', 'of', 'in', 'on', 'and', 'or', 'has', 'have', 'been', 'is', 'are']);

function tokenize(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
    ),
  );
}

/**
 * BM25 (via SQLite FTS5) isn't available — node:sqlite's bundled build doesn't ship the FTS5
 * extension. This is a keyword-only fallback: candidate rows are pulled via LIKE across the
 * concatenated searchable text, then ranked in JS by distinct-term coverage and hit count.
 */
export function keywordSearch(
  db: DatabaseSync,
  query: string,
  opts: { endpoint?: string; limit?: number } = {},
): Array<ChangeRow & { score: number }> {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const limit = Math.min(opts.limit ?? 10, 50);
  const conditions = terms.map(() => `searchable LIKE ?`).join(' OR ');
  const params: SQLInputValue[] = terms.map((t) => `%${t}%`);

  let sql = `
    SELECT * FROM (
      SELECT *, lower(
        coalesce(object_type,'') || ' ' || coalesce(object_name,'') || ' ' || coalesce(property_name,'') || ' ' ||
        coalesce(change_kind,'') || ' ' || coalesce(description,'') || ' ' ||
        coalesce(old_value,'') || ' ' || coalesce(new_value,'')
      ) AS searchable
      FROM changes
    )
    WHERE (${conditions})
  `;
  if (opts.endpoint) {
    sql += ' AND endpoint = ?';
    params.push(opts.endpoint);
  }

  const rows = db.prepare(sql).all(...params) as unknown as Array<ChangeRow & { searchable: string }>;

  const scored = rows.map((row) => {
    const distinctHits = terms.filter((t) => row.searchable.includes(t)).length;
    const totalHits = terms.reduce((sum, t) => sum + row.searchable.split(t).length - 1, 0);
    const { searchable, ...rest } = row;
    return { ...rest, score: distinctHits * 10 + totalHits };
  });

  scored.sort((a, b) => b.score - a.score || b.detected_at.localeCompare(a.detected_at));
  return scored.slice(0, limit);
}

const EMBEDDING_MODEL = 'text-embedding-3-small';

export function hasOpenAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function embedQuery(query: string): Promise<Float32Array | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: query }),
  });
  if (!res.ok) {
    console.error(`[graph-atlas-mcp] OpenAI embeddings API -> HTTP ${res.status}, falling back to keyword search`);
    return null;
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return new Float32Array(json.data[0].embedding);
}

/**
 * Vector KNN search via sqlite-vec (bundled loadable extension, PRD §7.5). Requires the DB
 * connection to have loaded the vec0 extension (see src/db.ts) and the change_embeddings table
 * to be populated (scripts/generate-embeddings.js) — returns [] if either isn't available.
 */
export function semanticSearch(
  db: DatabaseSync,
  queryEmbedding: Float32Array,
  opts: { endpoint?: string; limit?: number } = {},
): Array<ChangeRow & { score: number }> {
  const limit = Math.min(opts.limit ?? 10, 50);
  // Over-fetch before the endpoint filter so filtering doesn't starve the KNN result set.
  const k = opts.endpoint ? limit * 4 : limit;
  const vecBuffer = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);

  try {
    const neighbors = db
      .prepare(`SELECT rowid, distance FROM change_embeddings WHERE embedding MATCH ? AND k = ? ORDER BY distance`)
      .all(vecBuffer, k) as Array<{ rowid: number; distance: number }>;

    if (neighbors.length === 0) return [];

    const rowsById = new Map<number, ChangeRow>();
    const ids = neighbors.map((n) => n.rowid);
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM changes WHERE id IN (${placeholders})`).all(...ids) as unknown as ChangeRow[];
    for (const row of rows) rowsById.set(row.id, row);

    const results = neighbors
      .map((n) => {
        const row = rowsById.get(n.rowid);
        if (!row) return null;
        if (opts.endpoint && row.endpoint !== opts.endpoint) return null;
        return { ...row, score: 1 / (1 + n.distance) };
      })
      .filter((r): r is ChangeRow & { score: number } => r !== null);

    return results.slice(0, limit);
  } catch (err) {
    console.error(`[graph-atlas-mcp] semantic search unavailable (${(err as Error).message}), falling back to keyword search`);
    return [];
  }
}

/** Reciprocal Rank Fusion — standard k=60 constant (PRD §7.5). */
function reciprocalRankFusion(
  lists: Array<Array<ChangeRow & { score: number }>>,
  limit: number,
): Array<ChangeRow & { score: number }> {
  const RRF_K = 60;
  const fused = new Map<number, { row: ChangeRow; score: number }>();

  for (const list of lists) {
    list.forEach((row, rank) => {
      const existing = fused.get(row.id);
      const contribution = 1 / (RRF_K + rank + 1);
      if (existing) {
        existing.score += contribution;
      } else {
        fused.set(row.id, { row, score: contribution });
      }
    });
  }

  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row, score }) => ({ ...row, score }));
}

export async function hybridSearch(
  db: DatabaseSync,
  query: string,
  opts: { endpoint?: string; limit?: number; mode?: 'hybrid' | 'semantic' | 'keyword' } = {},
): Promise<{ mode: 'hybrid' | 'semantic' | 'keyword'; results: Array<ChangeRow & { score: number }> }> {
  const limit = opts.limit ?? 10;
  const requestedMode = opts.mode ?? 'hybrid';

  if (requestedMode === 'keyword') {
    return { mode: 'keyword', results: keywordSearch(db, query, opts) };
  }

  const queryEmbedding = await embedQuery(query);
  if (!queryEmbedding) {
    // No OpenAI key (or the call failed) — degrade to keyword-only, same as PRD §7.5 requires.
    return { mode: 'keyword', results: keywordSearch(db, query, opts) };
  }

  const semanticResults = semanticSearch(db, queryEmbedding, opts);
  if (requestedMode === 'semantic') {
    return { mode: 'semantic', results: semanticResults.slice(0, limit) };
  }

  const keywordResults = keywordSearch(db, query, opts);
  return { mode: 'hybrid', results: reciprocalRankFusion([keywordResults, semanticResults], limit) };
}
