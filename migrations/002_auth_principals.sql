ALTER TABLE api_auth_tokens
    ADD COLUMN organization_id VARCHAR(66) NULL
        AFTER tenant_id,
    ADD COLUMN scopes JSON NULL
        AFTER token_name;

UPDATE api_auth_tokens
SET scopes = JSON_ARRAY('tenant:read')
WHERE scopes IS NULL;

ALTER TABLE api_auth_tokens
    MODIFY COLUMN scopes JSON NOT NULL;

CREATE INDEX idx_api_auth_tokens_org
    ON api_auth_tokens (
        tenant_id,
        organization_id,
        active
    );
