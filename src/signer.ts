import {
  readFile,
  stat,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  privateKeyToAccount,
} from "viem/accounts";

import type {
  PrivateKeyAccount,
} from "viem/accounts";

import {
  config,
} from "./config.js";

function expandHome(
  value: string,
): string {
  if (
    value === "~"
  ) {
    return process.env.HOME ?? value;
  }

  if (
    value.startsWith(
      "~/",
    )
  ) {
    return resolve(
      process.env.HOME ?? "",
      value.slice(
        2,
      ),
    );
  }

  return resolve(
    value,
  );
}

export async function loadSimulationAccount():
Promise<PrivateKeyAccount> {
  const configuredAddress =
    config.traceforge.signerAddress;

  const keyFile =
    config.traceforge.signerKeyFile;

  if (
    !configuredAddress
  ) {
    throw new Error(
      "TRACEFORGE_SIGNER_ADDRESS is not configured.",
    );
  }

  if (
    !keyFile
  ) {
    throw new Error(
      "TRACEFORGE_SIGNER_KEY_FILE is not configured.",
    );
  }

  const filename =
    expandHome(
      keyFile,
    );

  const fileStat =
    await stat(
      filename,
    );

  if (
    (fileStat.mode & 0o077) !==
    0
  ) {
    throw new Error(
      "Signer key file permissions are too broad; expected owner-only access.",
    );
  }

  const privateKey =
    (
      await readFile(
        filename,
        "utf8",
      )
    ).trim();

  if (
    !/^0x[0-9a-fA-F]{64}$/.test(
      privateKey,
    )
  ) {
    throw new Error(
      "Signer key file does not contain a valid 32-byte private key.",
    );
  }

  const account =
    privateKeyToAccount(
      privateKey as `0x${string}`,
    );

  if (
    account.address.toLowerCase() !==
    configuredAddress.toLowerCase()
  ) {
    throw new Error(
      "Signer key-derived address does not match TRACEFORGE_SIGNER_ADDRESS.",
    );
  }

  return account;
}
