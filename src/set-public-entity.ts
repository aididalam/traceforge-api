import type {
  RowDataPacket,
} from "mysql2";

import {
  db,
} from "./db.js";

interface EntityRow
  extends RowDataPacket {
  entity_id: string;
}

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

const tenantId =
  argument(
    "--tenant",
  );

const entityId =
  argument(
    "--entity",
  );

const publish =
  process.argv.includes(
    "--publish",
  );

const unpublish =
  process.argv.includes(
    "--unpublish",
  );

const bytes32 =
  /^0x[0-9a-fA-F]{64}$/;

if (
  !tenantId ||
  !bytes32.test(
    tenantId,
  )
) {
  throw new Error(
    "--tenant must be a bytes32 tenant ID",
  );
}

if (
  !entityId ||
  !bytes32.test(
    entityId,
  )
) {
  throw new Error(
    "--entity must be a bytes32 entity ID",
  );
}

if (
  publish ===
  unpublish
) {
  throw new Error(
    "Exactly one of --publish or --unpublish is required",
  );
}

const normalizedTenantId =
  tenantId.toLowerCase();

const normalizedEntityId =
  entityId.toLowerCase();

try {
  if (
    publish
  ) {
    const [entities] =
      await db.query<
        EntityRow[]
      >(
        `
          SELECT entity_id
          FROM entities
          WHERE tenant_id = ?
            AND entity_id = ?
          LIMIT 1
        `,
        [
          normalizedTenantId,
          normalizedEntityId,
        ],
      );

    if (
      entities.length === 0
    ) {
      throw new Error(
        "Entity does not exist in the indexed read model.",
      );
    }

    await db.query(
      `
        INSERT IGNORE INTO public_entity_publications (
          tenant_id,
          entity_id
        )
        VALUES (?, ?)
      `,
      [
        normalizedTenantId,
        normalizedEntityId,
      ],
    );

    console.log(
      "PUBLIC ENTITY PUBLISHED."
    );
  } else {
    await db.query(
      `
        DELETE FROM public_entity_publications
        WHERE tenant_id = ?
          AND entity_id = ?
      `,
      [
        normalizedTenantId,
        normalizedEntityId,
      ],
    );

    console.log(
      "PUBLIC ENTITY UNPUBLISHED."
    );
  }

  console.log(
    `Tenant: ${normalizedTenantId}`,
  );

  console.log(
    `Entity: ${normalizedEntityId}`,
  );
} finally {
  await db.end();
}
