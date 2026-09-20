import fs from 'node:fs';
import path from 'node:path';

const ignored = new Set(['node_modules', 'dist', 'build', '.git', '.kiro']);
const extensions = /\.(html|css|js|jsx|ts|tsx|vue|svelte|json|md)$/;
const checks = [
  ['dynamic-html', /dangerouslySetInnerHTML|\bv-html\b|\.innerHTML\s*=/],
  ['insecure-http', /["'`](http:\/\/[^"'`\s]+)/],
  ['external-script', /<script[^>]+src\s*=\s*["']https?:\/\//i],
  ['new-tab-link', /target\s*=\s*["']_blank["']/i],
  ['possible-secret-assignment', /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{8,}["']/i]
];
const hits = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (extensions.test(entry.name)) {
      const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => checks.forEach(([category, regex]) => {
        if (regex.test(line)) hits.push({file: full, line: index + 1, category});
      }));
    }
  }
}
walk(process.cwd());
console.log(JSON.stringify({note: 'Potential indicators only. Inspect each hit; values are intentionally redacted.', hits}, null, 2));
