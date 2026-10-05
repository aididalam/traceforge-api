CREATE TABLE IF NOT EXISTS public_entity_tracking_ids (
    tracking_id BINARY(32) NOT NULL,
    tenant_id VARCHAR(66) NOT NULL,
    entity_id VARCHAR(66) NOT NULL,
    issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (tracking_id),
    UNIQUE KEY public_tracking_entity (tenant_id, entity_id)
);
