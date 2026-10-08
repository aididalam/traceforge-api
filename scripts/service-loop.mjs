import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const role = process.argv[2];
const files = role === 'public-sync' ? ['dist/sync-business-publications.js'] : role === 'indexer' ? ['dist/backfill.js', 'dist/project.js'] : [];
if (!files.length) throw Error('Unknown service role');
let stopping = false, child;
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {stopping = true; child?.kill('SIGTERM');});
const run = file => new Promise(resolve => {
  child = spawn(process.execPath, [file], {stdio:'inherit'});
  child.on('error', () => resolve(false)); child.on('exit', code => resolve(code === 0));
});
while (!stopping) {
  let ok = true;
  for (const file of files) if (stopping || !await run(file)) {ok = false; break;}
  if (ok) await writeFile('/tmp/service-heartbeat', String(Date.now()));
  else if (!stopping) console.error(`${role} cycle failed; retained state will be retried.`);
  if (!stopping) await new Promise(done => setTimeout(done, 1000 * Number(process.env.TRACEFORGE_SYNC_INTERVAL_SECONDS || 5)));
}
