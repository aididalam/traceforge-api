ALTER TABLE receipt_requests
 ADD KEY receipt_expiry(chain_id,contract_address,status,expires_at);
