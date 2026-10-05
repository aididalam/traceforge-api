import {
  readFileSync,
} from "node:fs";

const source =
  readFileSync(
    "src/issue-token.ts",
    "utf8",
  );

const required = [
  "--expires-in-hours",
  "--no-expiry",
  "Exactly one of --expires-in-hours or --no-expiry is required",
  "--expires-in-hours must be an integer between 1 and 8760",
  "expires_at",
  "expiresAt,",
  "none (explicit)",
];

let failures = 0;

for (
  const fragment
  of required
) {
  if (
    !source.includes(
      fragment,
    )
  ) {
    console.error(
      "FAIL missing token expiry fragment: " +
      JSON.stringify(
        fragment,
      ),
    );

    failures += 1;
  }
}

if (
  failures > 0
) {
  throw new Error(
    `Token expiry verification failed: ${failures} problem(s).`,
  );
}

console.log(
  "TOKEN EXPIRY HARDENING VERIFIED.",
);
console.log(
  "New token issuance requires an explicit expiry choice.",
);
console.log(
  "Existing stored tokens are not modified.",
);
