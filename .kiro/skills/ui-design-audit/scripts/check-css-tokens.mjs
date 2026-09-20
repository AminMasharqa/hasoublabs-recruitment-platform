import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'styles', 'assets', '.'];
const ignored = new Set(['node_modules', 'dist', 'build', '.git', '.kiro']);
const files = [];
function walk(dir, depth = 0) {
  if (!fs.existsSync(dir) || depth > 8) return;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, depth + 1);
    else if (/\.(css|scss|sass|less|html|jsx|tsx|vue|svelte)$/.test(entry.name)) files.push(full);
  }
}
for (const root of roots) if (root !== '.' || files.length === 0) walk(root);
const colors = new Map();
const families = new Map();
for (const file of [...new Set(files)]) {
  const text = fs.readFileSync(file, 'utf8');
  for (const value of text.match(/#[0-9a-fA-F]{3,8}\b/g) || []) colors.set(value.toLowerCase(), (colors.get(value.toLowerCase()) || 0) + 1);
  for (const match of text.matchAll(/font-family\s*:\s*([^;}]+)/g)) families.set(match[1].trim(), (families.get(match[1].trim()) || 0) + 1);
}
console.log(JSON.stringify({filesScanned: [...new Set(files)].length, uniqueHexColors: Object.fromEntries([...colors].sort()), fontFamilies: Object.fromEntries([...families].sort())}, null, 2));
