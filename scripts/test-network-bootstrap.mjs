import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, writeFile, chmod, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import {networkBundle, readNetworkBundle, readNetworkToken, maximumBundleBytes} from '../dist/network-bootstrap.js';
import {registerNetworkBootstrapRoutes} from '../dist/routes/network-bootstrap.js';

const token = 'a'.repeat(64), hash = '0x' + 'b'.repeat(64);
function fixture(chainId = 9009) {
  const genesis = JSON.stringify({config: {chainId, qbft: {blockperiodseconds: 2}}, extraData: '0x00'});
  return {format: 1, chainId, genesis, genesisFileHash: createHash('sha256').update(genesis).digest('hex'),
    genesisHash: hash, bootnodes: ['enode://' + 'c'.repeat(128) + '@192.168.1.10:30303'], besuImage: 'hyperledger/besu:26.9.0'};
}
const headers = {authorization: 'Bearer ' + token};
test('returns only the public bundle and rejects altered or wrong network configuration', () => {
  const bundle = fixture();
  assert.deepEqual(networkBundle({...bundle, privateKey: 'PRIVATE_SENTINEL'}, 9009), bundle);
  for (const value of [{...bundle, chainId: 9010}, {...bundle, genesis: bundle.genesis + ' '},
    {...bundle, bootnodes: []}, {...bundle, bootnodes: ['enode://' + 'c'.repeat(128) + '@localhost:65536']},
    {...bundle, besuImage: 'latest'}, {...bundle, genesisHash: '0x00'}, null])
    assert.throws(() => networkBundle(value, 9009));
});
test('disabled endpoint exposes no bundle and does not read credentials or RPC', async () => {
  const app = Fastify();
  const unavailable = async () => {throw Error('Must not be called');};
  await registerNetworkBootstrapRoutes(app, {enabled: false, token: unavailable, bundle: unavailable, genesisHash: unavailable});
  try {assert.equal((await app.inject({url: '/network/v1/bootstrap', headers})).statusCode, 404);}
  finally {await app.close();}
});
test('authentication, original genesis, running-network identity, token rotation and secret-free errors', async () => {
  const app = Fastify();
  let currentToken = token, liveHash = hash, failure = false, reads = 0;
  await app.register(swagger, {openapi: {info: {title: 'Network test', version: '1'},
    components: {securitySchemes: {networkBootstrapKey: {type: 'http', scheme: 'bearer'}}}}});
  await registerNetworkBootstrapRoutes(app, {enabled: true, token: async () => currentToken,
    bundle: async () => {reads++; if (failure) throw Error('/PRIVATE_PATH/SENTINEL'); return networkBundle({...fixture(), password: 'PRIVATE_SENTINEL'}, 9009);},
    genesisHash: async () => liveHash});
  try {
    for (const authorization of [undefined, 'Bearer ' + 'd'.repeat(64), 'Bearer business-session', 'Bearer ' + token + ' extra']) {
      const result = await app.inject({url: '/network/v1/bootstrap', headers: authorization ? {authorization} : {}});
      assert.equal(result.statusCode, 401); assert.equal(result.headers['www-authenticate'], 'Bearer');
    }
    assert.equal(reads, 0);
    assert.equal((await app.inject({url: '/network/v1/bootstrap?token=bad', headers})).statusCode, 400);
    assert.equal(reads, 0);
    const response = await app.inject({url: '/network/v1/bootstrap', headers});
    assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json(), fixture()); assert.ok(!response.body.includes('PRIVATE_SENTINEL'));
    liveHash = '0x' + 'e'.repeat(64);
    assert.equal((await app.inject({url: '/network/v1/bootstrap', headers})).statusCode, 503);
    liveHash = hash; failure = true;
    const failed = await app.inject({url: '/network/v1/bootstrap', headers});
    assert.equal(failed.statusCode, 503); assert.ok(!failed.body.includes('PRIVATE_PATH'));
    failure = false; currentToken = 'f'.repeat(64);
    assert.equal((await app.inject({url: '/network/v1/bootstrap', headers})).statusCode, 401);
    assert.equal((await app.inject({url: '/network/v1/bootstrap', headers: {authorization: 'Bearer ' + currentToken}})).statusCode, 200);
    assert.equal((await app.inject({method: 'POST', url: '/network/v1/bootstrap', headers})).statusCode, 404);
    assert.deepEqual(app.swagger().paths['/network/v1/bootstrap'].get.security, [{networkBootstrapKey: []}]);
  } finally {await app.close();}
});
test('each private installation supplies its own genesis and chain identity', async () => {
  for (const chainId of [9009, 123456]) {
    const app = Fastify();
    await registerNetworkBootstrapRoutes(app, {enabled: true, token: async () => token,
      bundle: async () => networkBundle(fixture(chainId), chainId), genesisHash: async () => hash});
    try {assert.equal((await app.inject({url: '/network/v1/bootstrap', headers})).json().chainId, chainId);}
    finally {await app.close();}
  }
});
test('bootstrap authentication attempts share a rate budget, including encoded paths', async () => {
  const app = Fastify();
  await app.register(rateLimit, {max: 2, timeWindow: '1 minute'});
  await registerNetworkBootstrapRoutes(app, {enabled: true, token: async () => token,
    bundle: async () => fixture(), genesisHash: async () => hash});
  try {
    assert.equal((await app.inject('/network/v1/bootstrap')).statusCode, 401);
    assert.equal((await app.inject('/network/v1/bootstrap')).statusCode, 401);
    assert.equal((await app.inject({url: '/%6eetwork/v1/bootstrap', headers: {'x-forwarded-for': '192.0.2.1'}})).statusCode, 429);
  } finally {await app.close();}
});
test('mounted token must be private, and oversized bundle files are rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'traceforge-bootstrap-'));
  const secret = join(directory, 'token'), bundle = join(directory, 'bundle.json');
  try {
    await writeFile(secret, token, {mode: 0o600}); assert.equal(await readNetworkToken(secret), token);
    await chmod(secret, 0o644); await assert.rejects(readNetworkToken(secret), /private/);
    await writeFile(bundle, JSON.stringify(fixture()), {mode: 0o600});
    assert.deepEqual(await readNetworkBundle(bundle, 9009), fixture());
    await writeFile(bundle, 'x'.repeat(maximumBundleBytes + 1));
    await assert.rejects(readNetworkBundle(bundle, 9009), /bundle file/);
  } finally {await rm(directory, {recursive: true, force: true});}
});
