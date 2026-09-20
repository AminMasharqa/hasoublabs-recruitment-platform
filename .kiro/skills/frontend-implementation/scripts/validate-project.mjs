import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

if (!fs.existsSync('package.json')) {
  console.log('Static project: no package.json. Continue with metadata and browser QA.');
  process.exit(0);
}
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const runner = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const names = ['lint', 'typecheck', 'check', 'build'].filter((name) => pkg.scripts?.[name]);
if (!names.length) {
  console.log('No lint, typecheck, check, or build script is defined.');
  process.exit(0);
}
let failed = false;
for (const name of names) {
  console.log(`\n> npm run ${name}`);
  const result = spawnSync(runner, ['run', name], {stdio: 'inherit', env: {...process.env, CI: '1'}});
  if (result.status !== 0) { failed = true; break; }
}
process.exit(failed ? 1 : 0);
