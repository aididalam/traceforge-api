import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}`,
    );
  }

  return value;
}

export const config = {
  host:
    process.env.API_HOST ??
    "127.0.0.1",

  port:
    Number(
      process.env.API_PORT ??
      "3000",
    ),

  mysql: {
    host:
      required(
        "MYSQL_HOST",
      ),

    port:
      Number(
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
