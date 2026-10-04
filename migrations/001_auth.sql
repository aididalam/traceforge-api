CREATE TABLE IF NOT EXISTS api_auth_tokens (
    token_id CHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    token_hint VARCHAR(20) NOT NULL,
    tenant_id VARCHAR(66) NOT NULL,
    token_name VARCHAR(128) NOT NULL,
    active BOOLEAN NOT NULL
        DEFAULT TRUE,
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (token_id),
    UNIQUE KEY uq_api_auth_tokens_hash (
        token_hash
    ),
    KEY idx_api_auth_tokens_tenant (
        tenant_id,
        active
    )
);
