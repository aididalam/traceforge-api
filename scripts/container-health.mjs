import {readFile} from 'node:fs/promises';
const role = process.argv[2];
try {
  if (role === 'api') {
    const result = await fetch('http://127.0.0.1:3000/ready', {signal:AbortSignal.timeout(8000)});
    if (!result.ok) throw Error();
  } else if (Date.now() - Number(await readFile('/tmp/service-heartbeat','utf8')) > 120000) throw Error();
} catch {process.exitCode = 1;}
