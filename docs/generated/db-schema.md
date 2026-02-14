---
owner: sigil-core
status: active
last_reviewed: 2026-02-13
source_of_truth: false
audience: contributors
---

# Database Schema (Generated)

This document summarizes the MySQL schema used by `sigil/internal/storage/mysql` after compaction-scaling cutover.

## generations

```sql
CREATE TABLE generations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(128) NOT NULL,
  generation_id VARCHAR(255) NOT NULL,
  conversation_id VARCHAR(255) NULL,
  created_at DATETIME(6) NOT NULL,
  payload MEDIUMBLOB NOT NULL,
  payload_size_bytes INT NOT NULL,
  compacted BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_by VARCHAR(255) NULL,
  claimed_at DATETIME(6) NULL,
  compacted_at DATETIME(6) NULL,
  UNIQUE KEY ux_generations_tenant_generation (tenant_id, generation_id),
  KEY idx_generations_tenant_conversation_created (tenant_id, conversation_id, created_at),
  KEY idx_generations_tenant_compacted_claimed_created (tenant_id, compacted, claimed_by, created_at)
);
```

## conversations

```sql
CREATE TABLE conversations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(128) NOT NULL,
  conversation_id VARCHAR(255) NOT NULL,
  last_generation_at DATETIME(6) NOT NULL,
  generation_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY ux_conversations_tenant_conversation (tenant_id, conversation_id),
  KEY idx_conversations_tenant_updated_at (tenant_id, updated_at)
);
```

## conversation_ratings

```sql
CREATE TABLE conversation_ratings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(128) NOT NULL,
  rating_id VARCHAR(128) NOT NULL,
  conversation_id VARCHAR(255) NOT NULL,
  generation_id VARCHAR(255) NULL,
  rating INT NOT NULL,
  comment TEXT NULL,
  metadata_json JSON NOT NULL,
  rater_id VARCHAR(255) NULL,
  source VARCHAR(64) NULL,
  created_at DATETIME(6) NOT NULL,
  ingested_at DATETIME(6) NOT NULL,
  UNIQUE KEY ux_conversation_ratings_tenant_rating (tenant_id, rating_id),
  KEY idx_conversation_ratings_tenant_conv_created (tenant_id, conversation_id, created_at),
  KEY idx_conversation_ratings_tenant_conv_rating_created (tenant_id, conversation_id, rating, created_at),
  KEY idx_conversation_ratings_tenant_rating_created (tenant_id, rating, created_at)
);
```

## conversation_rating_summaries

```sql
CREATE TABLE conversation_rating_summaries (
  tenant_id VARCHAR(128) NOT NULL,
  conversation_id VARCHAR(255) NOT NULL,
  total_count INT NOT NULL DEFAULT 0,
  good_count INT NOT NULL DEFAULT 0,
  bad_count INT NOT NULL DEFAULT 0,
  latest_rating INT NOT NULL DEFAULT 0,
  latest_rated_at DATETIME(6) NOT NULL,
  latest_bad_at DATETIME(6) NULL,
  has_bad_rating BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (tenant_id, conversation_id),
  KEY idx_conversation_rating_summaries_tenant_has_bad (tenant_id, has_bad_rating, latest_bad_at),
  KEY idx_conversation_rating_summaries_tenant_latest (tenant_id, latest_rated_at)
);
```

## conversation_annotations

```sql
CREATE TABLE conversation_annotations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(128) NOT NULL,
  annotation_id VARCHAR(128) NOT NULL,
  conversation_id VARCHAR(255) NOT NULL,
  generation_id VARCHAR(255) NULL,
  annotation_type VARCHAR(32) NOT NULL,
  body TEXT NULL,
  tags_json JSON NOT NULL,
  metadata_json JSON NOT NULL,
  operator_id VARCHAR(255) NOT NULL,
  operator_login VARCHAR(255) NULL,
  operator_name VARCHAR(255) NULL,
  created_at DATETIME(6) NOT NULL,
  ingested_at DATETIME(6) NOT NULL,
  UNIQUE KEY ux_conversation_annotations_tenant_annotation (tenant_id, annotation_id),
  KEY idx_conversation_annotations_tenant_conv_created (tenant_id, conversation_id, created_at),
  KEY idx_conversation_annotations_tenant_conv_type_created (tenant_id, conversation_id, annotation_type, created_at)
);
```

## conversation_annotation_summaries

```sql
CREATE TABLE conversation_annotation_summaries (
  tenant_id VARCHAR(128) NOT NULL,
  conversation_id VARCHAR(255) NOT NULL,
  annotation_count INT NOT NULL DEFAULT 0,
  latest_annotation_type VARCHAR(32) NULL,
  latest_annotated_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (tenant_id, conversation_id),
  KEY idx_conversation_annotation_summaries_tenant_latest (tenant_id, latest_annotated_at)
);
```

## compaction_blocks

```sql
CREATE TABLE compaction_blocks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(128) NOT NULL,
  block_id VARCHAR(255) NOT NULL,
  min_time DATETIME(6) NOT NULL,
  max_time DATETIME(6) NOT NULL,
  generation_count INT NOT NULL,
  size_bytes BIGINT NOT NULL,
  object_path VARCHAR(1024) NOT NULL,
  index_path VARCHAR(1024) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE KEY ux_compaction_blocks_tenant_block (tenant_id, block_id),
  KEY idx_compaction_blocks_tenant_time (tenant_id, min_time, max_time)
);
```

## compactor_leases

```sql
CREATE TABLE compactor_leases (
  tenant_id VARCHAR(128) NOT NULL,
  shard_id INT NOT NULL,
  owner_id VARCHAR(255) NOT NULL,
  leased_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  PRIMARY KEY (tenant_id, shard_id)
);
```

## Notes

- `AutoMigrate` performs a hard reset of `compactor_leases` during startup migration for the shard-key cutover.
- Stale claim cleanup clears `claimed_by`/`claimed_at` on uncompacted rows older than `SIGIL_COMPACTOR_CLAIM_TTL`.
