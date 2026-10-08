ALTER TABLE chain_write_operations ADD KEY idx_chain_write_wallet_nonce (organization_id,block_number,nonce);
