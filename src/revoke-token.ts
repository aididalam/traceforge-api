import type {
  ResultSetHeader,
} from "mysql2";

import {
  db,
} from "./db.js";

function argument(
  name: string,
): string | undefined {
  const index =
    process.argv.indexOf(
      name,
    );

  if (
    index < 0
  ) {
    return undefined;
  }

  return process.argv[
    index + 1
  ];
}

const tokenId =
  argument(
    "--token-id",
  );

if (
  !tokenId
) {
  throw new Error(
    "--token-id is required",
  );
}

const [result] =
  await db.query<
    ResultSetHeader
  >(
    `
      UPDATE api_auth_tokens
      SET active = FALSE
      WHERE token_id = ?
        AND active = TRUE
    `,
    [
      tokenId,
    ],
  );

await db.end();

if (
  result.affectedRows ===
  0
) {
  throw new Error(
    "Active token was not found.",
  );
}

console.log(
  `Revoked API token: ${tokenId}`,
);
