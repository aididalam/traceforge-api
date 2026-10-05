CREATE TABLE IF NOT EXISTS business_wallets (
  organization_id VARCHAR(66) NOT NULL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL UNIQUE,
  tenant_id VARCHAR(66) NOT NULL UNIQUE,
  production_role_id VARCHAR(66) NOT NULL,
  business_name VARCHAR(120) NOT NULL,
  business_type VARCHAR(120) NOT NULL,
  public_profile BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS business_product_records (
  tracking_id VARCHAR(66) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(66) NOT NULL,
  entity_id VARCHAR(66) NOT NULL,
  creator_organization_id VARCHAR(66) NOT NULL,
  public_details BOOLEAN NOT NULL DEFAULT FALSE,
  publication_initialized BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY business_product_identity (tenant_id, entity_id)
);
