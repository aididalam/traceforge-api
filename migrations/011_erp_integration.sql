CREATE TABLE IF NOT EXISTS erp_integration_keys (
 key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 organization_id VARCHAR(66) NOT NULL,
 account_id CHAR(36) NOT NULL,
 key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 key_prefix VARCHAR(16) NOT NULL,
 key_name VARCHAR(120) NOT NULL,
 scopes JSON NOT NULL,
 expires_at TIMESTAMP NOT NULL,
 revoked_at TIMESTAMP NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY erp_keys_business(organization_id,created_at)
);
CREATE TABLE IF NOT EXISTS erp_jobs (
 job_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 chain_id BIGINT UNSIGNED NOT NULL,
 contract_address VARCHAR(42) NOT NULL,
 organization_id VARCHAR(66) NOT NULL,
 key_id CHAR(36) NOT NULL,
 job_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 request_hash VARCHAR(66) NOT NULL,
 reference VARCHAR(120) NULL,
 occurred_at DATETIME(3) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY erp_job_retry(chain_id,contract_address,organization_id,job_key_hash),
 KEY erp_job_business(organization_id,created_at)
);
CREATE TABLE IF NOT EXISTS erp_operations (
 sequence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 chain_id BIGINT UNSIGNED NOT NULL,
 contract_address VARCHAR(42) NOT NULL,
 organization_id VARCHAR(66) NOT NULL,
 key_id CHAR(36) NOT NULL,
 item_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 request_hash VARCHAR(66) NOT NULL,
 action ENUM('create','receive','remove') NOT NULL,
 request_json JSON NOT NULL,
 prepared_json JSON NULL,
 status ENUM('QUEUED','PROCESSING','RETRY','CONFIRMED','FAILED','CANCELLED') NOT NULL DEFAULT 'QUEUED',
 attempts INT UNSIGNED NOT NULL DEFAULT 0,
 next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 lease_until DATETIME(3) NULL,
 lease_token CHAR(36) NULL,
 error_code VARCHAR(64) NULL,
 result_json JSON NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY erp_item_retry(chain_id,contract_address,organization_id,item_key_hash),
 KEY erp_dispatch(status,next_attempt_at,sequence_id),
 KEY erp_business_order(chain_id,contract_address,organization_id,sequence_id)
);
CREATE TABLE IF NOT EXISTS erp_job_items (
 job_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 position SMALLINT UNSIGNED NOT NULL,
 operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(job_id,position),
 UNIQUE KEY erp_job_operation(job_id,operation_id)
);
