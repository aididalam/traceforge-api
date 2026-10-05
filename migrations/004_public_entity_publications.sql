CREATE TABLE IF NOT EXISTS public_entity_publications (
    tenant_id VARCHAR(66) NOT NULL,
    entity_id VARCHAR(66) NOT NULL,
    published_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (
        tenant_id,
        entity_id
    )
);
