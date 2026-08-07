#!/usr/bin/env node
// npx/bin launcher. node:sqlite is available unflagged on newer Node versions but
// needs --experimental-sqlite on Node 22.x — probe for it and re-exec with the
// flag when required, so `npx graph-atlas-mcp` works on every supported Node.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverUrl = new URL('../dist/index.js', import.meta.url);

let sqliteAvailable = true;
try {
  await import('node:sqlite');
} catch {
  sqliteAvailable = false;
}

if (sqliteAvailable) {
  await import(serverUrl.href);
} else {
  const child = spawn(process.execPath, ['--experimental-sqlite', fileURLToPath(serverUrl), ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 1);
    }
  });
}
