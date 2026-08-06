// Generates OpenAI embeddings for change records that don't have one yet (incremental, not a
// full re-embed — PRD §7.5). Requires OPENAI_API_KEY; degrades to a no-op with a clear message
// if it isn't set, same as the search tool degrades to keyword-only without embeddings.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import * as sqliteVec from 'sqlite-vec';
import { openDbWithVec } from './schema.js';

const DB_PATH = fileURLToPath(new URL('../graph-atlas.db', import.meta.url));
const MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 100;
const API_KEY = process.env.OPENAI_API_KEY;

// text-embedding-3-small's limit is 8192 tokens/input. raw_diff can carry a full CSDL XML
// fragment for complex types with many properties, which blows past that — and OpenAI rejects
// the ENTIRE batch if any single input is too long, not just the offending item. raw_diff is
// last in the join, so truncating from the end drops it first, keeping the more useful fields
// (object/property/description) intact. ~4 chars/token for English, but XML tokenizes worse
// (tags, brackets), so this cap is deliberately conservative.
const MAX_EMBEDDING_CHARS = 6000;

function embeddingText(row) {
  const text = [row.object_type, row.object_name, row.property_name, row.change_kind, row.description, row.old_value, row.new_value, row.raw_diff]
    .filter(Boolean)
    .join(' ');
  return text.length > MAX_EMBEDDING_CHARS ? text.slice(0, MAX_EMBEDDING_CHARS) : text;
}

async function embedBatch(texts) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings API -> HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.data.map((d) => d.embedding);
}

// Defense in depth against the truncation cap above missing some future edge case (e.g. a
// non-English/multi-byte-heavy description that tokenizes worse than expected): rather than
// losing an entire 100-record batch to one bad input, halve and retry so only the actual
// offending record(s) are ultimately skipped.
async function embedBatchWithFallback(rows) {
  const texts = rows.map(embeddingText);
  try {
    return await embedBatch(texts);
  } catch (err) {
    if (rows.length === 1) throw err;
    const mid = Math.floor(rows.length / 2);
    const [left, right] = await Promise.all([
      embedBatchWithFallback(rows.slice(0, mid)).catch(() => null),
      embedBatchWithFallback(rows.slice(mid)).catch(() => null),
    ]);
    if (!left && !right) throw err;
    return [...(left ?? new Array(mid).fill(null)), ...(right ?? new Array(rows.length - mid).fill(null))];
  }
}

async function main() {
  if (!API_KEY) {
    console.log('OPENAI_API_KEY not set — skipping embedding generation. search_changes will run in keyword-only mode.');
    return;
  }

  const db = openDbWithVec(DatabaseSync, sqliteVec, DB_PATH);

  const pending = db
    .prepare(`
      SELECT c.* FROM changes c
      LEFT JOIN change_embeddings e ON e.rowid = c.id
      WHERE e.rowid IS NULL
      ORDER BY c.id
    `)
    .all();

  if (pending.length === 0) {
    console.log('All change records already have embeddings — nothing to do.');
    db.close();
    return;
  }

  console.log(`Embedding ${pending.length} change record(s) with ${MODEL}...`);
  const insertStmt = db.prepare('INSERT INTO change_embeddings (rowid, embedding) VALUES (?, ?)');

  let done = 0;
  let skipped = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    let embeddings;
    try {
      embeddings = await embedBatchWithFallback(batch);
    } catch (err) {
      console.error(`Batch ${i}-${i + batch.length} failed even after per-record fallback: ${err.message} — skipping entire batch.`);
      skipped += batch.length;
      continue;
    }
    for (let j = 0; j < batch.length; j++) {
      if (!embeddings[j]) {
        console.error(`  record id=${batch[j].id} could not be embedded — skipping.`);
        skipped++;
        continue;
      }
      const vecBuffer = Buffer.from(new Float32Array(embeddings[j]).buffer);
      insertStmt.run(BigInt(batch[j].id), vecBuffer);
      done++;
    }
    console.log(`  ${done}/${pending.length}`);
  }

  console.log(`Done. Embedded ${done} change records${skipped ? ` (${skipped} skipped)` : ''}.`);
  db.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
