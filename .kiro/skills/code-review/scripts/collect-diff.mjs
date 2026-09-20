import {spawnSync} from 'node:child_process';

function git(args) {
  const result = spawnSync('git', args, {encoding: 'utf8'});
  return result.status === 0 ? result.stdout.trim() : `(git ${args.join(' ')} unavailable)`;
}
console.log(JSON.stringify({status: git(['status', '--short']), stat: git(['diff', '--stat']), whitespaceErrors: git(['diff', '--check'])}, null, 2));
