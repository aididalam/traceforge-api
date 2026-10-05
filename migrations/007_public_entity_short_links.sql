CREATE TABLE IF NOT EXISTS public_entity_short_links (
    short_code CHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    tracking_id BINARY(32) NOT NULL,
    issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (short_code),
    UNIQUE KEY public_short_tracking (tracking_id)
);
