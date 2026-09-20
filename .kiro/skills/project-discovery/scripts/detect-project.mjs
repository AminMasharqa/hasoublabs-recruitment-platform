import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const exists = (p) => fs.existsSync(path.join(root, p));
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const packageManager = exists('pnpm-lock.yaml') ? 'pnpm' : exists('yarn.lock') ? 'yarn' : exists('bun.lock') || exists('bun.lockb') ? 'bun' : exists('package-lock.json') ? 'npm' : 'unknown';
let pkg = {};
if (exists('package.json')) {
  try { pkg = json('package.json'); } catch { pkg = {parseError: true}; }
}
const deps = {...(pkg.dependencies || {}), ...(pkg.devDependencies || {})};
const markers = {
  next: exists('next.config.js') || exists('next.config.mjs') || Boolean(deps.next),
  vite: ['vite.config.js','vite.config.ts','vite.config.mjs'].some(exists) || Boolean(deps.vite),
  astro: exists('astro.config.mjs') || Boolean(deps.astro),
  svelte: exists('svelte.config.js') || Boolean(deps.svelte),
  vue: Boolean(deps.vue),
  react: Boolean(deps.react),
  staticHtml: exists('index.html') && !exists('package.json')
};
const candidates = ['index.html','src/main.js','src/main.ts','src/main.jsx','src/main.tsx','src/App.vue','src/App.svelte','app/page.tsx','pages/index.js','README.md'].filter(exists);
console.log(JSON.stringify({packageManager, scripts: pkg.scripts || {}, markers, candidateEntryFiles: candidates}, null, 2));
