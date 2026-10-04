import type {
  FastifyInstance,
} from "fastify";

import {
  authContextFor,
} from "../auth.js";

export async function registerAuthRoutes(
  app: FastifyInstance,
) {
  app.get(
    "/v1/auth/me",
    {
      schema: {
        tags: [
          "auth",
        ],
      },
    },
    async (
      request,
    ) => {
      const auth =
        authContextFor(
          request,
        );

      return {
        tokenId:
          auth.tokenId,

        tokenName:
          auth.tokenName,

        tenantId:
          auth.tenantId,

        organizationId:
          auth.organizationId,

        scopes:
          auth.scopes,
      };
    },
  );
}
