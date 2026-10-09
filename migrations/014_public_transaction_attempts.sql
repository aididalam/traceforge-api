CREATE TABLE IF NOT EXISTS chain_write_attempts (
  attempt_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
    transaction_hash VARCHAR(66) NOT NULL PRIMARY KEY,
    operation_id CHAR(36) NOT NULL,
    serialized_transaction LONGTEXT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_write_attempt_operation (operation_id, created_at)
);
