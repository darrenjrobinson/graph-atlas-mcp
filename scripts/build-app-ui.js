// Bundles app-ui/<name>/main.ts + styles.css + index.html into a single self-contained
// HTML file (dist/app-ui/<name>.html) — MCP Apps resources must be one blob with no external
// network dependencies (CDN scripts, remote fonts, etc. are blocked by the host's CSP).
import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, 'dist', 'app-ui');

async function buildApp(appName) {
  const appDir = join(ROOT, 'app-ui', appName);
  const result = await esbuild.build({
    entryPoints: [join(appDir, 'main.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    write: false,
    logLevel: 'warning',
  });
  const js = result.outputFiles[0].text;
  const css = readFileSync(join(appDir, 'styles.css'), 'utf8');
  const body = readFileSync(join(appDir, 'index.html'), 'utf8');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${css}</style>
</head>
<body>
${body}
<script>${js}</script>
</body>
</html>
`;

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${appName}.html`);
  writeFileSync(outPath, html);
  console.log(`Built ${outPath} (${(html.length / 1024).toFixed(0)}KB)`);
}

async function main() {
  await buildApp('atlas-app');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
