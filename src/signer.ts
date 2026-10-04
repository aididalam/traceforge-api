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

interface SignerMapEntry {
  organizationId: string;
  address: string;
  keyFile: string;
}

interface SignerMapDocument {
  schemaVersion: number;
  signers: SignerMapEntry[];
}

function expandHome(
  value: string,
): string {
  if (
    value === "~"
  ) {
    return process.env.HOME ??
      value;
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

function bytes32(
  name: string,
  value: string,
): string {
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(
      value,
    )
  ) {
    throw new Error(
      `Invalid ${name}: expected bytes32.`,
    );
  }

  return value.toLowerCase();
}

function ethereumAddress(
  name: string,
  value: string,
): string {
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(
      value,
    )
  ) {
    throw new Error(
      `Invalid ${name}: expected Ethereum address.`,
    );
  }

  return value.toLowerCase();
}

async function requireOwnerOnlyFile(
  filename: string,
  label: string,
) {
  const fileStat =
    await stat(
      filename,
    );

  if (
    (fileStat.mode & 0o077) !==
    0
  ) {
    throw new Error(
      `${label} permissions are too broad; expected owner-only access.`,
    );
  }
}

async function loadAccount(
  configuredAddress: string,
  keyFile: string,
): Promise<PrivateKeyAccount> {
  const normalizedAddress =
    ethereumAddress(
      "signer address",
      configuredAddress,
    );

  const filename =
    expandHome(
      keyFile,
    );

  await requireOwnerOnlyFile(
    filename,
    "Signer key file",
  );

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
    normalizedAddress
  ) {
    throw new Error(
      "Signer key-derived address does not match the configured signer address.",
    );
  }

  return account;
}

async function loadSignerMap():
Promise<SignerMapDocument | null> {
  const mapFile =
    config.traceforge.signerMapFile;

  if (
    !mapFile
  ) {
    return null;
  }

  const filename =
    expandHome(
      mapFile,
    );

  await requireOwnerOnlyFile(
    filename,
    "Signer map file",
  );

  const parsed =
    JSON.parse(
      await readFile(
        filename,
        "utf8",
      ),
    ) as SignerMapDocument;

  if (
    parsed.schemaVersion !==
      1 ||
    !Array.isArray(
      parsed.signers,
    )
  ) {
    throw new Error(
      "Signer map must have schemaVersion=1 and a signers array.",
    );
  }

  const seenOrganizations =
    new Set<string>();

  for (
    const entry of parsed.signers
  ) {
    const organizationId =
      bytes32(
        "signer organizationId",
        entry.organizationId,
      );

    ethereumAddress(
      "signer address",
      entry.address,
    );

    if (
      !entry.keyFile ||
      typeof entry.keyFile !==
      "string"
    ) {
      throw new Error(
        "Signer map entry keyFile is required.",
      );
    }

    if (
      seenOrganizations.has(
        organizationId,
      )
    ) {
      throw new Error(
        `Duplicate signer mapping for organization ${organizationId}.`,
      );
    }

    seenOrganizations.add(
      organizationId,
    );
  }

  return parsed;
}

export async function loadOrganizationAccount(
  organizationId: string,
): Promise<PrivateKeyAccount> {
  const normalizedOrganizationId =
    bytes32(
      "organizationId",
      organizationId,
    );

  const signerMap =
    await loadSignerMap();

  if (
    signerMap
  ) {
    const entry =
      signerMap.signers.find(
        (candidate) =>
          candidate.organizationId.toLowerCase() ===
          normalizedOrganizationId,
      );

    if (
      !entry
    ) {
      throw new Error(
        `No signer is configured for organization ${normalizedOrganizationId}.`,
      );
    }

    return loadAccount(
      entry.address,
      entry.keyFile,
    );
  }

  const configuredAddress =
    config.traceforge.signerAddress;

  const keyFile =
    config.traceforge.signerKeyFile;

  if (
    !configuredAddress
  ) {
    throw new Error(
      "TRACEFORGE_SIGNER_MAP_FILE or TRACEFORGE_SIGNER_ADDRESS must be configured.",
    );
  }

  if (
    !keyFile
  ) {
    throw new Error(
      "TRACEFORGE_SIGNER_MAP_FILE or TRACEFORGE_SIGNER_KEY_FILE must be configured.",
    );
  }

  return loadAccount(
    configuredAddress,
    keyFile,
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

  return loadAccount(
    configuredAddress,
    keyFile,
  );
}
