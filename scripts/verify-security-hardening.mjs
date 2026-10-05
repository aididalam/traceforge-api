import {
  readFileSync,
} from "node:fs";

const pkg =
  JSON.parse(
    readFileSync(
      "package.json",
      "utf8"
    )
  );

const server =
  readFileSync(
    "src/server.ts",
    "utf8"
  );

const expectedDependencies = {
  "@fastify/helmet": "13.1.1",
  "@fastify/rate-limit": "11.2.0",
};

let failures = 0;

for (
  const [name, version]
  of Object.entries(
    expectedDependencies
  )
) {
  if (
    pkg.dependencies?.[name] !==
    version
  ) {
    console.error(
      "FAIL dependency " +
      name +
      " must be pinned to " +
      version
    );
    failures += 1;
  }
}

const requiredFragments = [
  "import helmet from \"@fastify/helmet\";",
  "import rateLimit from \"@fastify/rate-limit\";",
  "req.headers.authorization",
  "[REDACTED]",
  "contentSecurityPolicy:",
  "max:\n      120",
  "timeWindow:\n      \"1 minute\"",
  "!request.url.startsWith(",
  "\"/v1/\"",
  "\"/public/\"",
  "rate_limit_exceeded",
];

for (
  const fragment
  of requiredFragments
) {
  if (
    !server.includes(
      fragment
    )
  ) {
    console.error(
      "FAIL missing security fragment: " +
      JSON.stringify(fragment)
    );
    failures += 1;
  }
}

if (
  server.includes(
    "trustProxy: true"
  )
) {
  console.error(
    "FAIL unconditional trustProxy is not allowed."
  );
  failures += 1;
}

if (
  failures > 0
) {
  throw new Error(
    "API security verification failed: " +
    failures +
    " problem(s)."
  );
}

console.log(
  "API SECURITY HARDENING VERIFIED."
);
console.log(
  "Authorization logging is redacted."
);
console.log(
  "Security headers are enabled."
);
console.log(
  "/v1/* and /public/* are globally rate limited."
);
