import "dotenv/config";

function required(
  name: string,
): string {
  const value =
    process.env[name];

  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}`,
    );
  }

  return value;
}

function positiveInteger(
  name: string,
  value: string,
): number {
  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(
      parsed,
    ) ||
    parsed <= 0
  ) {
    throw new Error(
      `Invalid positive integer for ${name}: ${value}`,
    );
  }

  return parsed;
}

function address(
  name: string,
  value: string,
): string {
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(
      value,
    )
  ) {
    throw new Error(
      `Invalid Ethereum address for ${name}: ${value}`,
    );
  }

  return value.toLowerCase();
}

export const config = {
  host:
    process.env.API_HOST ??
    "127.0.0.1",

  port:
    positiveInteger(
      "API_PORT",
      process.env.API_PORT ??
        "3000",
    ),

  traceforge: {
    chainId:
      positiveInteger(
        "TRACEFORGE_CHAIN_ID",
        required(
          "TRACEFORGE_CHAIN_ID",
        ),
      ),

    contractAddress:
      address(
        "TRACEFORGE_CONTRACT_ADDRESS",
        required(
          "TRACEFORGE_CONTRACT_ADDRESS",
        ),
      ),
  },

  mysql: {
    host:
      required(
        "MYSQL_HOST",
      ),

    port:
      positiveInteger(
        "MYSQL_PORT",
        required(
          "MYSQL_PORT",
        ),
      ),

    database:
      required(
        "MYSQL_DATABASE",
      ),

    user:
      required(
        "MYSQL_USER",
      ),

    password:
      required(
        "MYSQL_PASSWORD",
      ),
  },
};
