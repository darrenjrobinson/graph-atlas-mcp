// Scrapes Merill's Graph Permissions Explorer (public, server-side rendered, no auth needed)
// into the `permissions` table (PRD §6.2). Re-runnable monthly — upserts by permission_name.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { openDb } from './schema.js';
import { fetchWithRetry } from './http.js';

const SITEMAP_URL = 'https://graphpermissions.merill.net/sitemap.xml';
const DB_PATH = fileURLToPath(new URL('../graph-atlas.db', import.meta.url));
const RATE_LIMIT_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractPermissionUrls(sitemapXml) {
  const urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  return urls.filter((u) => /\/permission\/[^/]+\.html$/.test(u));
}

function permissionNameFromUrl(url) {
  return decodeURIComponent(url.split('/').pop().replace(/\.html$/, ''));
}

export function parseMainTable(html) {
  const tableMatch = html.match(/<table>[\s\S]*?<\/table>/);
  if (!tableMatch) return {};
  const rows = [...tableMatch[0].matchAll(/<tr>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<\/tr>/g)];

  const fields = {};
  for (const [, category, app, delegated] of rows) {
    fields[category.trim()] = { app: app.trim(), delegated: delegated.trim() };
  }
  return fields;
}

export function parseGraphEndpoints(html) {
  const endpoints = new Set();
  for (const tabId of ['tabpanel_1_apiv1', 'tabpanel_1_apibeta']) {
    const sectionMatch = html.match(new RegExp(`<section id="${tabId}"[\\s\\S]*?<\\/section>`));
    if (!sectionMatch) continue;
    for (const m of sectionMatch[0].matchAll(/<a href="[^"]*">((?:GET|POST|PATCH|PUT|DELETE) [^<]+)<\/a>/g)) {
      endpoints.add(m[1].trim());
    }
  }
  return [...endpoints];
}

export function parseResources(html) {
  const groupMatch = html.match(/<div class="tabGroup" id="tabgroup_2">[\s\S]*?<ul role="tablist">([\s\S]*?)<\/ul>/);
  if (!groupMatch) return [];
  const resources = new Set();
  for (const m of groupMatch[1].matchAll(/<a href="#tabpanel_2_[^"]*"[^>]*>([^<]+)<\/a>/g)) {
    resources.add(m[1].trim());
  }
  return [...resources];
}

export function parsePermissionPage(html, permissionName) {
  const table = parseMainTable(html);
  const identifiers = table.Identifier ?? {};
  const displayText = table.DisplayText ?? {};
  const description = table.Description ?? {};
  const consent = table.AdminConsentRequired ?? {};

  return {
    permission_name: permissionName,
    app_identifier: identifiers.app || null,
    delegated_identifier: identifiers.delegated || null,
    display_text: displayText.app || displayText.delegated || null,
    description_app: description.app || null,
    description_delegated: description.delegated || null,
    admin_consent_required_app: consent.app ? Number(consent.app.toLowerCase() === 'yes') : null,
    admin_consent_required_delegated: consent.delegated ? Number(consent.delegated.toLowerCase() === 'yes') : null,
    graph_endpoints: JSON.stringify(parseGraphEndpoints(html)),
    resources: JSON.stringify(parseResources(html)),
    combined_with: null, // not reliably extractable from page structure — see README known limitations
  };
}

async function main() {
  console.log('Fetching permission sitemap...');
  const sitemapRes = await fetchWithRetry(SITEMAP_URL);
  if (!sitemapRes.ok) throw new Error(`Sitemap fetch failed: HTTP ${sitemapRes.status}`);
  const sitemapXml = await sitemapRes.text();
  const urls = extractPermissionUrls(sitemapXml);
  console.log(`Found ${urls.length} permission pages.`);

  const db = openDb(DatabaseSync, DB_PATH);
  const upsertStmt = db.prepare(`
    INSERT INTO permissions (
      permission_name, app_identifier, delegated_identifier, display_text,
      description_app, description_delegated, admin_consent_required_app, admin_consent_required_delegated,
      graph_endpoints, resources, combined_with, collected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(permission_name) DO UPDATE SET
      app_identifier = excluded.app_identifier,
      delegated_identifier = excluded.delegated_identifier,
      display_text = excluded.display_text,
      description_app = excluded.description_app,
      description_delegated = excluded.description_delegated,
      admin_consent_required_app = excluded.admin_consent_required_app,
      admin_consent_required_delegated = excluded.admin_consent_required_delegated,
      graph_endpoints = excluded.graph_endpoints,
      resources = excluded.resources,
      collected_at = excluded.collected_at
  `);

  const collectedAt = new Date().toISOString();
  let done = 0;
  let failed = 0;
  for (const url of urls) {
    const permissionName = permissionNameFromUrl(url);
    try {
      const res = await fetchWithRetry(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const row = parsePermissionPage(html, permissionName);
      upsertStmt.run(
        row.permission_name, row.app_identifier, row.delegated_identifier, row.display_text,
        row.description_app, row.description_delegated, row.admin_consent_required_app, row.admin_consent_required_delegated,
        row.graph_endpoints, row.resources, row.combined_with, collectedAt,
      );
      done++;
    } catch (err) {
      console.error(`  ${permissionName} failed: ${err.message}`);
      failed++;
    }
    if ((done + failed) % 100 === 0) console.log(`  ${done + failed}/${urls.length}`);
    await sleep(RATE_LIMIT_MS);
  }

  console.log(`\nDone. Collected ${done} permissions (${failed} failed).`);
  db.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
