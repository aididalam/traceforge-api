CREATE TABLE IF NOT EXISTS operator_accounts (
  account_id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  tenant_id VARCHAR(66) NOT NULL,
  organization_id VARCHAR(66) NOT NULL,
  password_digest VARCHAR(200) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY operator_account_workspace (tenant_id, organization_id, active)
);
CREATE TABLE IF NOT EXISTS operator_invitations (
  invitation_hash CHAR(64) NOT NULL PRIMARY KEY,
  email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_id VARCHAR(66) NOT NULL,
  organization_id VARCHAR(66) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY operator_invite_email (email, expires_at)
);
CREATE TABLE IF NOT EXISTS operator_sessions (
  session_hash CHAR(64) NOT NULL PRIMARY KEY,
  account_id CHAR(36) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY operator_session_account (account_id, expires_at)
);
