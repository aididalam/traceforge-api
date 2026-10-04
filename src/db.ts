import mysql from "mysql2/promise";

import {
  config,
} from "./config.js";

export const db =
  mysql.createPool({
    host:
      config.mysql.host,

    port:
      config.mysql.port,

    database:
      config.mysql.database,

    user:
      config.mysql.user,

    password:
      config.mysql.password,

    connectionLimit:
      10,

    charset:
      "utf8mb4",
  });
