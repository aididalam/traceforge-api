ALTER TABLE business_product_records
 ADD chain_id BIGINT UNSIGNED NULL, ADD contract_address VARCHAR(42) NULL,
 ADD registration_metadata_hash VARCHAR(66) NULL,
 ADD external_id VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
 ADD initial_quantity BIGINT UNSIGNED NULL,
 ADD confirmed BOOLEAN NOT NULL DEFAULT FALSE,
 ADD KEY external_product_lookup(external_id,confirmed,chain_id,contract_address,creator_organization_id);
CREATE TABLE business_code_reservations (
 code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 organization_id VARCHAR(66) NOT NULL UNIQUE,
 reserved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE business_code_sequence (
 sequence_id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
 code_length TINYINT UNSIGNED NOT NULL,
 ordinal DECIMAL(25,0) NOT NULL,
 CHECK(code_length BETWEEN 1 AND 16)
);
INSERT INTO business_code_sequence(sequence_id,code_length,ordinal) VALUES(1,1,0);
