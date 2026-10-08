import {createHash, timingSafeEqual} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {NetworkBundle} from '../network-bootstrap.js';

interface Dependencies {
  enabled: boolean;
  token: () => Promise<string>;
  bundle: () => Promise<NetworkBundle>;
  genesisHash: () => Promise<string>;
}
const problem = (code: string) => ({error: {code, message: 'Network bootstrap is unavailable or access is denied.'}});

export async function registerNetworkBootstrapRoutes(app: FastifyInstance, dependencies: Dependencies) {
  app.get('/network/v1/bootstrap', {
    schema: {tags: ['network'], security: [{networkBootstrapKey: []}],
      querystring: {type: 'object', additionalProperties: false, maxProperties: 0},
      description: 'Authorized node bootstrap: original genesis configuration, identity and reachable peers.'},
    onRequest: async (_request, reply) => {reply.header('Cache-Control', 'no-store');},
    preHandler: async (request, reply) => {
      if (!dependencies.enabled) return reply.code(404).send(problem('network_bootstrap_disabled'));
      const match = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/);
      if (!match) return reply.header('WWW-Authenticate', 'Bearer').code(401).send(problem('authentication_required'));
      try {
        const expected = await dependencies.token();
        const digest = (value: string) => createHash('sha256').update(value).digest();
        if (!timingSafeEqual(digest(match[1]), digest(expected)))
          return reply.header('WWW-Authenticate', 'Bearer').code(401).send(problem('invalid_token'));
      } catch {return reply.code(503).send(problem('network_bootstrap_unavailable'));}
    },
  }, async (_request, reply) => {
    try {
      const bundle = await dependencies.bundle();
      if (bundle.genesisHash !== (await dependencies.genesisHash()).toLowerCase())
        throw Error('Exported bundle is not the running network');
      return bundle;
    } catch {return reply.code(503).send(problem('network_bootstrap_unavailable'));}
  });
}
