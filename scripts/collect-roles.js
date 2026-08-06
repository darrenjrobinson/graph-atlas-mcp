// Collects Entra built-in roles and their microsoft.directory/* actions from the Microsoft
// Learn permissions reference (PRD §6.3 fallback path — no app registration available for the
// authenticated Graph API route, so this uses the public, server-side rendered doc source
// instead of GET /roleManagement/directory/roleDefinitions).
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { openDb } from './schema.js';
import { fetchWithRetry } from './http.js';

const REFERENCE_URL = 'https://raw.githubusercontent.com/MicrosoftDocs/entra-docs/main/docs/identity/role-based-access-control/permissions-reference.md';
const INCLUDE_BASE_URL = 'https://raw.githubusercontent.com/MicrosoftDocs/entra-docs/main/docs/identity/role-based-access-control/includes/';
const DB_PATH = fileURLToPath(new URL('../graph-atlas.db', import.meta.url));
const RATE_LIMIT_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseRoleSummaryTable(markdown) {
  const tableMatch = markdown.match(/## All roles[\s\S]*?> \| Role \| Description \| Template ID \|\n> \| --- \| --- \| --- \|\n([\s\S]*?)\n\n/);
  if (!tableMatch) throw new Error('Could not find the "All roles" summary table');

  const rows = [];
  for (const line of tableMatch[1].split('\n')) {
    const m = line.match(/^> \| \[([^\]]+)\]\(#[^)]+\) \| (.+) \| ([0-9a-f-]{36}) \|$/);
    if (!m) continue;
    const [, roleName, descriptionCell, templateId] = m;
    rows.push({
      role_name: roleName.trim(),
      template_id: templateId.trim(),
      is_privileged: /privileged-label\.png/.test(descriptionCell) ? 1 : 0,
      description: descriptionCell.replace(/<br\/>\[!\[Privileged label icon\.\]\([^)]+\)\]\([^)]+\)/g, '').trim(),
    });
  }
  return rows;
}

export function findRoleIncludes(markdown) {
  // Maps role name -> include filename, in document order (each "## Role Name" heading is
  // immediately followed by its [!INCLUDE [slug](includes/slug.md)] directive).
  const map = new Map();
  const headingRe = /^## (.+)$/gm;
  let match;
  while ((match = headingRe.exec(markdown))) {
    const roleName = match[1].trim();
    if (roleName === 'All roles') continue;
    const rest = markdown.slice(match.index, match.index + 400);
    const includeMatch = rest.match(/\[!INCLUDE \[[^\]]+\]\(includes\/([^)]+)\)\]/);
    if (includeMatch) map.set(roleName, includeMatch[1]);
  }
  return map;
}

export function parseActionsTable(markdown) {
  const tableMatch = markdown.match(/> \| Actions \| Description \|\n> \| --- \| --- \|\n([\s\S]*?)(?:\n\n|$)/);
  if (!tableMatch) return [];
  const actions = [];
  for (const line of tableMatch[1].split('\n')) {
    const m = line.match(/^> \| (\S+) \| (.+) \|$/);
    if (m) actions.push(m[1].trim());
  }
  return actions;
}

async function main() {
  console.log('Fetching Entra built-in roles reference...');
  const referenceRes = await fetchWithRetry(REFERENCE_URL);
  if (!referenceRes.ok) throw new Error(`Reference fetch failed: HTTP ${referenceRes.status}`);
  const referenceMd = await referenceRes.text();

  const summaryRows = parseRoleSummaryTable(referenceMd);
  const includeMap = findRoleIncludes(referenceMd);
  console.log(`Found ${summaryRows.length} roles, ${includeMap.size} with linked action detail pages.`);

  const db = openDb(DatabaseSync, DB_PATH);
  const upsertStmt = db.prepare(`
    INSERT INTO roles (role_name, template_id, description, is_privileged, actions, collected_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(template_id) DO UPDATE SET
      role_name = excluded.role_name,
      description = excluded.description,
      is_privileged = excluded.is_privileged,
      actions = excluded.actions,
      collected_at = excluded.collected_at
  `);

  const collectedAt = new Date().toISOString();
  let done = 0;
  let failed = 0;

  for (const role of summaryRows) {
    const includeFile = includeMap.get(role.role_name);
    let actions = [];
    if (includeFile) {
      try {
        const res = await fetchWithRetry(`${INCLUDE_BASE_URL}${includeFile}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        actions = parseActionsTable(await res.text());
      } catch (err) {
        console.error(`  ${role.role_name} action detail failed: ${err.message}`);
        failed++;
      }
    }

    upsertStmt.run(role.role_name, role.template_id, role.description, role.is_privileged, JSON.stringify(actions), collectedAt);
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${summaryRows.length}`);
    await sleep(RATE_LIMIT_MS);
  }

  console.log(`\nDone. Collected ${done} roles (${failed} action-detail fetches failed).`);
  db.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
