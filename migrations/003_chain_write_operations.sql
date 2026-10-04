CREATE TABLE IF NOT EXISTS chain_write_operations (
    operation_id CHAR(36) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash CHAR(66) NOT NULL,

    token_id CHAR(36) NOT NULL,
    tenant_id VARCHAR(66) NOT NULL,
    organization_id VARCHAR(66) NOT NULL,
    entity_id VARCHAR(66) NOT NULL,

    operation_name VARCHAR(64) NOT NULL,
    role_id VARCHAR(66) NOT NULL,

    status VARCHAR(32) NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    serialized_transaction LONGTEXT NULL,

    nonce BIGINT UNSIGNED NOT NULL,
    gas_estimate BIGINT UNSIGNED NOT NULL,
    gas_limit BIGINT UNSIGNED NOT NULL,
    block_number BIGINT UNSIGNED NULL,
    gas_used BIGINT UNSIGNED NULL,

    request_json JSON NOT NULL,
    error_code VARCHAR(64) NULL,
    error_message TEXT NULL,

    created_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (operation_id),

    UNIQUE KEY uq_chain_write_idempotency (
        tenant_id,
        operation_name,
        idempotency_key
    ),

    UNIQUE KEY uq_chain_write_transaction (
        transaction_hash
    ),

    KEY idx_chain_write_entity (
        tenant_id,
        entity_id,
        created_at
    ),

    KEY idx_chain_write_status (
        status,
        updated_at
    )
);
