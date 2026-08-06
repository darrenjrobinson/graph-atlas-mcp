#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openDatabase } from './db.js';
import * as searchChanges from './tools/search-changes.js';
import * as getRecentChanges from './tools/get-recent-changes.js';
import * as getObjectHistory from './tools/get-object-history.js';
import * as getChangeDetail from './tools/get-change-detail.js';
import * as getSnapshotSummary from './tools/get-snapshot-summary.js';
import * as getPermissionContext from './tools/get-permission-context.js';

async function main() {
  const db = await openDatabase();

  const server = new McpServer({ name: 'graph-atlas', version: '0.1.0' });

  for (const tool of [searchChanges, getRecentChanges, getObjectHistory, getChangeDetail, getSnapshotSummary, getPermissionContext]) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any) => tool.handler(db, args),
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
