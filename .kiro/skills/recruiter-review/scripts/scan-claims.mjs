import fs from 'node:fs';
import path from 'node:path';

const ignored = new Set(['node_modules', 'dist', 'build', '.git', '.kiro']);
const extensions = /\.(html|md|txt|json|js|jsx|ts|tsx|vue|svelte)$/;
const patterns = [
  ['percentage', /\b\d+(?:\.\d+)?%\b/],
  ['money', /[$€£]\s?\d[\d,.]*/],
  ['scale', /\b\d[\d,.]*\s?(?:users?|customers?|clients?|requests?|downloads?)\b/i],
  ['superlative', /\b(?:best|leading|expert|world-class|award-winning)\b/i],
  ['experience duration', /\b\d+\+?\s+years?\b/i]
];
const hits = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (extensions.test(entry.name)) {
      const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => patterns.forEach(([kind, regex]) => { if (regex.test(line)) hits.push({file: full, line: index + 1, category: kind}); }));
    }
  }
}
walk(process.cwd());
console.log(JSON.stringify({note: 'Verification prompts only; a hit is not proof of a false claim.', hits}, null, 2));
