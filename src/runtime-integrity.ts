import {
  keccak256,
} from "viem";

import type {
  Hex,
} from "viem";

import {
  config,
} from "./config.js";

export function runtimeBytecodeIntegrity(
  bytecode: Hex | undefined,
) {
  const expected =
    config.traceforge.runtimeBytecodeHash;

  if (
    !expected
  ) {
    throw new Error(
      "TRACEFORGE_RUNTIME_BYTECODE_HASH is not configured.",
    );
  }

  if (
    !bytecode ||
    bytecode === "0x"
  ) {
    return {
      ok:
        false,

      expected,

      actual:
        null,
    };
  }

  const actual =
    keccak256(
      bytecode,
    ).toLowerCase();

  return {
    ok:
      actual ===
      expected,

    expected,

    actual,
  };
}
