import {
  keccak256,
} from "viem";

import type {
  Hex,
} from "viem";

export function runtimeBytecodeIntegrity(
  bytecode: Hex | undefined,
) {
  const expected =
    process.env.TRACEFORGE_RUNTIME_BYTECODE_HASH;

  if (
    !expected ||
    !/^0x[0-9a-fA-F]{64}$/.test(
      expected,
    )
  ) {
    throw new Error(
      "TRACEFORGE_RUNTIME_BYTECODE_HASH must be configured as a bytes32 hash.",
    );
  }

  if (
    !bytecode ||
    bytecode === "0x"
  ) {
    return {
      ok:
        false,

      expected:
        expected.toLowerCase(),

      actual:
        null,
    };
  }

  const actual =
    keccak256(
      bytecode,
    );

  return {
    ok:
      actual.toLowerCase() ===
      expected.toLowerCase(),

    expected:
      expected.toLowerCase(),

    actual:
      actual.toLowerCase(),
  };
}
