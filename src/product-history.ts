// claimCustody/closeEntity emit their business event immediately before a
// matching TraceRecorded log. Keep one business action in paginated histories,
// while preserving every raw log for the indexer and technical discovery API.
// Match the adjacent log and its payload, not just the transaction hash: one
// transaction can contain multiple independent actions or standalone traces.
export const businessHistoryPredicate = `NOT (ce.event_name = 'TraceRecorded' AND EXISTS (
  SELECT 1 FROM chain_events companion
  WHERE companion.chain_id = ce.chain_id AND companion.contract_address = ce.contract_address
    AND companion.transaction_hash = ce.transaction_hash AND companion.log_index + 1 = ce.log_index
    AND companion.event_name IN ('CustodyClaimed', 'EntityClosed')
    AND JSON_EXTRACT(companion.event_args, '$.tenantId') = JSON_EXTRACT(ce.event_args, '$.tenantId')
    AND JSON_EXTRACT(companion.event_args, '$.entityId') = JSON_EXTRACT(ce.event_args, '$.entityId')
    AND JSON_EXTRACT(companion.event_args, '$.eventType') = JSON_EXTRACT(ce.event_args, '$.eventType')
    AND JSON_EXTRACT(companion.event_args, '$.evidenceHash') = JSON_EXTRACT(ce.event_args, '$.evidenceHash')
    AND JSON_EXTRACT(companion.event_args, '$.actor') = JSON_EXTRACT(ce.event_args, '$.actor')
    AND CASE companion.event_name
      WHEN 'CustodyClaimed' THEN JSON_EXTRACT(companion.event_args, '$.toOrganizationId')
      ELSE JSON_EXTRACT(companion.event_args, '$.organizationId') END = JSON_EXTRACT(ce.event_args, '$.organizationId')
    AND CASE companion.event_name
      WHEN 'EntityClosed' THEN JSON_EXTRACT(companion.event_args, '$.closedAt')
      ELSE JSON_EXTRACT(companion.event_args, '$.timestamp') END = JSON_EXTRACT(ce.event_args, '$.timestamp')
)) AND NOT (ce.event_name = 'EntityCreated' AND EXISTS (
 SELECT 1 FROM chain_events registration
 WHERE registration.chain_id=ce.chain_id AND registration.contract_address=ce.contract_address
  AND registration.transaction_hash=ce.transaction_hash AND registration.log_index=ce.log_index+1
  AND registration.event_name='ProductRegistered'
  AND JSON_EXTRACT(registration.event_args,'$.tenantId')=JSON_EXTRACT(ce.event_args,'$.tenantId')
  AND JSON_EXTRACT(registration.event_args,'$.entityId')=JSON_EXTRACT(ce.event_args,'$.entityId')
  AND JSON_EXTRACT(registration.event_args,'$.organizationId')=JSON_EXTRACT(ce.event_args,'$.organizationId')
  AND JSON_EXTRACT(registration.event_args,'$.actor')=JSON_EXTRACT(ce.event_args,'$.actor')
  AND JSON_EXTRACT(registration.event_args,'$.registrationMetadataHash')=JSON_EXTRACT(ce.event_args,'$.metadataHash')
  AND JSON_EXTRACT(registration.event_args,'$.timestamp')=JSON_EXTRACT(ce.event_args,'$.createdAt')
))`;
