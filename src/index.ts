#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { openDatabase } from './db.js';
import { VERSION } from './version.js';
import * as searchChanges from './tools/search-changes.js';
import * as getRecentChanges from './tools/get-recent-changes.js';
import * as getObjectHistory from './tools/get-object-history.js';
import * as getChangeDetail from './tools/get-change-detail.js';
import * as getSnapshotSummary from './tools/get-snapshot-summary.js';
import * as getPermissionContext from './tools/get-permission-context.js';
import * as getServerInfo from './tools/get-server-info.js';
import * as schemaChangeReport from './tools/schema-change-report.js';
import * as visualizeSchemaGraph from './tools/visualize-schema-graph.js';
import * as expandSchemaNode from './tools/expand-schema-node.js';
import * as searchSchemaObjects from './tools/search-schema-objects.js';
import * as getNodeTimeline from './tools/get-node-timeline.js';

const APP_UI_DIR = fileURLToPath(new URL('../dist/app-ui', import.meta.url));
const RESOURCE_URI = 'ui://graph-atlas/atlas-app.html';

// Injected into the host's context at connect time — the model's only zero-cost view of
// what this server is. Keep the two release channels distinct: "a new Graph Atlas release"
// is ambiguous between a daily database refresh and a semver server release.
const INSTRUCTIONS =
  `Graph Atlas (server v${VERSION}) tracks Microsoft Graph API schema changes on the v1.0 and beta endpoints ` +
  `across Entra ID, Identity Governance, and related workloads, enriched with permission/role context and an ` +
  `interactive schema visualiser. Two release channels exist and users say "release" for either: the snapshot ` +
  `DATABASE is re-released daily when changes are detected, as calendar-tagged GitHub releases (e.g. v2026.08.07) ` +
  `whose notes summarise that day's schema changes; the SERVER code is released on npm with semver versions ` +
  `(e.g. v${VERSION}) whose GitHub release notes carry the changelog. When asked about this server itself or ` +
  `"what's new in the latest Graph Atlas release", call get_server_info first — it reports the running version, ` +
  `its changelog entry, data freshness, and release links. For what changed in the Microsoft Graph schema, use ` +
  `get_recent_changes or search_changes.`;

/** _meta helpers — ship both the spec key and the deprecated flat key for host compat. */
function uiMeta(visibility: string[], withResource: boolean) {
  return {
    ui: { ...(withResource ? { resourceUri: RESOURCE_URI } : {}), visibility },
    ...(withResource ? { 'ui/resourceUri': RESOURCE_URI } : {}),
  };
}

// No external network access at all from the app iframe; let the host draw a border.
const uiResourceMeta = { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } };

async function main() {
  const db = await openDatabase();

  const server = new McpServer({ name: 'graph-atlas', version: VERSION }, { instructions: INSTRUCTIONS });

  // The UI is optional — every tool still works without it (e.g. before the first build).
  let appHtml: string | null = null;
  try {
    appHtml = readFileSync(join(APP_UI_DIR, 'atlas-app.html'), 'utf8');
  } catch {
    console.error('[graph-atlas-mcp] dist/app-ui/atlas-app.html missing — run "npm run build:app-ui"; continuing without the visualizer UI');
  }
  const hasUi = appHtml !== null;

  for (const tool of [searchChanges, getRecentChanges, getObjectHistory, getChangeDetail, getSnapshotSummary, getPermissionContext, getServerInfo, schemaChangeReport]) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any) => tool.handler(db, args),
    );
  }

  // Visibility split (pattern from EntraPulse Polyarchy): only the launcher carries the
  // resourceUri; expand/search serve both the model and the app; the timeline is app-only
  // (the model already has get_object_history).
  const appTools: Array<[typeof visualizeSchemaGraph | typeof expandSchemaNode | typeof searchSchemaObjects | typeof getNodeTimeline, string[], boolean]> = [
    [visualizeSchemaGraph, ['model', 'app'], hasUi],
    [expandSchemaNode, ['model', 'app'], false],
    [searchSchemaObjects, ['model', 'app'], false],
    [getNodeTimeline, ['app'], false],
  ];
  for (const [tool, visibility, withResource] of appTools) {
    registerAppTool(
      server,
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema, _meta: uiMeta(visibility, withResource) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any) => tool.handler(db, args),
    );
  }

  if (hasUi) {
    registerAppResource(
      server,
      'Graph Atlas',
      RESOURCE_URI,
      { description: 'Interactive Microsoft Graph schema visualizer', _meta: uiResourceMeta },
      async () => ({
        contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: appHtml as string, _meta: uiResourceMeta }],
      }),
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[graph-atlas-mcp] server started (stdio)');
}

main().catch((err) => {
  console.error('[graph-atlas-mcp] fatal:', err);
  process.exit(1);
});
