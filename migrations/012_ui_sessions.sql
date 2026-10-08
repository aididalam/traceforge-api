CREATE TABLE IF NOT EXISTS ui_operator_sessions (
 handle_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 encrypted_token TEXT CHARACTER SET ascii NOT NULL,
 expires_ms BIGINT UNSIGNED NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ui_session_expiry(expires_ms)
);
