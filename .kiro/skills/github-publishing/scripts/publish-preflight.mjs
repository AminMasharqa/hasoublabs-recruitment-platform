import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = process.cwd();
const dangerousNames = [/^\.env(?:\.|$)/, /\.pem$/i, /\.key$/i, /^id_rsa/i, /^credentials?$/i];
const generated = new Set(['node_modules', 'dist', 'build', 'coverage', '.DS_Store']);
const findings = [];

function walk(dir, depth = 0) {
  if (depth > 10) return;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === '.git' || entry.name === '.kiro') continue;
    const relative = path.relative(root, path.join(dir, entry.name));
    if (generated.has(entry.name)) findings.push({severity: 'blocker', category: 'generated-or-dependency-path', path: relative});
    if (dangerousNames.some((pattern) => pattern.test(entry.name))) findings.push({severity: 'blocker', category: 'sensitive-filename', path: relative});
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !generated.has(entry.name)) walk(full, depth + 1);
    else if (entry.isFile() && entry.size > 10 * 1024 * 1024) findings.push({severity: 'review', category: 'large-file-over-10MB', path: relative});
  }
}

walk(root);
const git = spawnSync('git', ['status', '--short'], {encoding: 'utf8'});
const remote = spawnSync('git', ['remote', '-v'], {encoding: 'utf8'});
console.log(JSON.stringify({
  note: 'Preflight indicators only. Do not publish until every blocker is resolved and the candidate approves repository visibility.',
  gitRepository: git.status === 0,
  gitStatus: git.status === 0 ? git.stdout.trim() : 'not initialized',
  remotes: remote.status === 0 ? remote.stdout.trim().split(/\r?\n/).filter(Boolean) : [],
  findings
}, null, 2));
process.exit(findings.some((item) => item.severity === 'blocker') ? 2 : 0);
