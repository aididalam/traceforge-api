CREATE TABLE IF NOT EXISTS public_entity_presentations (
    tenant_id VARCHAR(66) NOT NULL,
    entity_id VARCHAR(66) NOT NULL,
    metadata_hash VARCHAR(66) NOT NULL,
    product_info JSON NOT NULL,
    organization_profiles JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, entity_id)
);
