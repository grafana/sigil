---
owner: sigil-core
status: completed
last_reviewed: 2026-02-14
source_of_truth: true
audience: both
---

# Conversation Ratings and Operator Annotations

## Implementation status (2026-02-14)

- Ratings and annotations HTTP APIs are implemented in Sigil with MySQL storage, summaries, idempotency handling, and query filter support.
- Ratings SDK APIs are implemented in Go, JS/TS, Python, Java, and .NET, with transport and validation tests.
- Plugin backend proxy integration is implemented.
- Plugin frontend now renders conversation summaries, filters, ratings timeline, annotations timeline, and merged timeline events.

## Problem statement

Sigil needs two related but different conversation signals:

- user-facing quality signal from SDK/app flows (thumbs up/down + comment)
- operator workflow signal from Sigil/Grafana UI (annotations while triaging)

Using one overloaded "evaluation" concept blurs responsibilities and creates product ambiguity. We need explicit contracts:

- `rating` for user/SDK-facing feedback
- `annotation` for operator-facing notes/tags/status

## Decision summary

1. Use separate APIs:
- Ratings API for user/SDK feedback.
- Annotations API for operator actions.

2. Keep ratings in all SDKs, do not expose operator annotation APIs in SDKs.

3. Drive "bad conversation" flag from ratings only (`BAD` exists), not from annotations.

4. Persist both signals with append-only event tables and pre-aggregated summaries for list filtering.

## Goals

- Add first-class conversation ratings API in Sigil (HTTP).
- Add first-class operator annotations API in Sigil (HTTP for plugin/UI path).
- Support more than one rating and more than one annotation per conversation.
- Keep idempotent writes for retries.
- Capture who created operator annotations from Grafana/plugin context.
- Surface bad conversations and annotation activity cheaply in query/UI paths.

## Non-goals

- LLM-as-judge or automated evaluation pipelines.
- Offline eval job orchestration.
- Annotation taxonomy automation.
- PII moderation/classification in v1.

## API contracts

### Ratings API (user/SDK-facing)

#### HTTP

- `POST /api/v1/conversations/{conversation_id}/ratings`
- `GET /api/v1/conversations/{conversation_id}/ratings?limit=50&cursor=<opaque>`

#### Request payload

```json
{
  "rating_id": "rat_01k2y2k0g9m5p8",
  "rating": "CONVERSATION_RATING_VALUE_BAD",
  "comment": "The answer skipped key dashboard context.",
  "metadata": {
    "channel": "assistant-chat",
    "session_id": "sess-123"
  },
  "generation_id": "gen_01k2y2f8h0m3",
  "rater_id": "end-user-42",
  "source": "sdk-js"
}
```

#### JSON shape

- `rating`: `CONVERSATION_RATING_VALUE_GOOD | CONVERSATION_RATING_VALUE_BAD`
- `metadata`: JSON object
- `created_at`: RFC3339 timestamp

### Annotations API (operator-facing)

Annotations are for Sigil/Grafana operator workflows, not end-user SDK flows.

#### HTTP

- `POST /api/v1/conversations/{conversation_id}/annotations`
- `GET /api/v1/conversations/{conversation_id}/annotations?limit=50&cursor=<opaque>`

#### Request payload

```json
{
  "annotation_id": "ann_01k2y2mr38d0x7",
  "annotation_type": "TRIAGE_STATUS",
  "body": "Marked for prompt regression follow-up.",
  "tags": {
    "status": "needs_review",
    "owner": "llm-platform"
  },
  "metadata": {
    "ticket": "INC-10421"
  },
  "generation_id": "gen_01k2y2f8h0m3"
}
```

#### Operator identity capture

Plugin backend injects Grafana user context headers when calling Sigil:

- `X-Sigil-Operator-Id`
- `X-Sigil-Operator-Login`
- `X-Sigil-Operator-Name`

Sigil stores these on annotation rows as the actor identity. Direct client payload actor fields are not used for operator attribution.

## Auth boundary

Ratings and annotations use the same auth boundary as generation ingest:

- same protected middleware and tenant extraction path
- same tenant header: `X-Scope-OrgID`
- auth enabled (`SIGIL_AUTH_ENABLED=true`): missing tenant context => `401 Unauthorized`
- auth disabled (`SIGIL_AUTH_ENABLED=false`): `SIGIL_FAKE_TENANT_ID` is injected (local/dev)

No separate auth mode is introduced for ratings/annotations in this phase.

## Validation and idempotency

### Ratings

- `rating_id` required, max 128 chars.
- `conversation_id` required, max 255 chars.
- `rating` required: `CONVERSATION_RATING_VALUE_GOOD` or `CONVERSATION_RATING_VALUE_BAD`.
- `comment` optional, max 4096 bytes.
- `metadata` optional, max 16 KiB serialized JSON.
- Idempotency key: `(tenant_id, rating_id)`.

### Annotations

- `annotation_id` required, max 128 chars.
- `conversation_id` required, max 255 chars.
- `annotation_type` required: `NOTE|LABEL|TRIAGE_STATUS|ROOT_CAUSE|FOLLOW_UP`.
- `body` optional, max 8192 bytes.
- `tags` optional, max 4 KiB serialized JSON.
- `metadata` optional, max 16 KiB serialized JSON.
- Operator headers required for create path.
- Idempotency key: `(tenant_id, annotation_id)`.

### Retry conflict behavior

For both APIs:

- same idempotency key + same payload => success replay
- same key + different payload => conflict
  - HTTP: `409 Conflict`

## Storage design (MySQL)

### `conversation_ratings`

```sql
CREATE TABLE conversation_ratings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id VARCHAR(128) NOT NULL,
  rating_id VARCHAR(128) NOT NULL,
  conversation_id VARCHAR(255) NOT NULL,
  generation_id VARCHAR(255) NULL,
  rating TINYINT NOT NULL,
  comment TEXT NULL,
  metadata_json JSON NOT NULL,
  rater_id VARCHAR(255) NULL,
  source VARCHAR(64) NULL,
  created_at DATETIME(6) NOT NULL,
  ingested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY ux_conversation_ratings_tenant_rating (tenant_id, rating_id),
  KEY idx_conversation_ratings_tenant_conv_created (tenant_id, conversation_id, created_at),
  KEY idx_conversation_ratings_tenant_conv_rating_created (tenant_id, conversation_id, rating, created_at),
  KEY idx_conversation_ratings_tenant_rating_created (tenant_id, rating, created_at)
);
```

### `conversation_rating_summaries`

```sql
CREATE TABLE conversation_rating_summaries (
  tenant_id VARCHAR(128) NOT NULL,
  conversation_id VARCHAR(255) NOT NULL,
  total_count INT NOT NULL DEFAULT 0,
  good_count INT NOT NULL DEFAULT 0,
  bad_count INT NOT NULL DEFAULT 0,
  latest_rating TINYINT NOT NULL DEFAULT 0,
  latest_rated_at DATETIME(6) NOT NULL,
  latest_bad_at DATETIME(6) NULL,
  has_bad_rating BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (tenant_id, conversation_id),
  KEY idx_conversation_rating_summaries_tenant_has_bad (tenant_id, has_bad_rating, latest_bad_at),
  KEY idx_conversation_rating_summaries_tenant_latest (tenant_id, latest_rated_at)
);
```

### `conversation_annotations`

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
  ingested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY ux_conversation_annotations_tenant_annotation (tenant_id, annotation_id),
  KEY idx_conversation_annotations_tenant_conv_created (tenant_id, conversation_id, created_at),
  KEY idx_conversation_annotations_tenant_conv_type_created (tenant_id, conversation_id, annotation_type, created_at)
);
```

### `conversation_annotation_summaries`

```sql
CREATE TABLE conversation_annotation_summaries (
  tenant_id VARCHAR(128) NOT NULL,
  conversation_id VARCHAR(255) NOT NULL,
  annotation_count INT NOT NULL DEFAULT 0,
  latest_annotation_type VARCHAR(32) NULL,
  latest_annotated_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (tenant_id, conversation_id),
  KEY idx_conversation_annotation_summaries_tenant_latest (tenant_id, latest_annotated_at)
);
```

## Query and UI behavior

### Conversation list additions

- include `rating_summary` (good/bad counts, latest, `has_bad_rating`)
- include `annotation_summary` (count, latest annotation type/time)
- filters:
  - `has_bad_rating=true|false`
  - `has_annotations=true|false`

### Bad-conversation flag

- `bad` is defined only by ratings: `has_bad_rating = true`.
- annotations do not set bad flag by default.

This keeps the quality signal consistent and prevents operator notes from changing user-quality semantics.

## SDK contract

Add ratings only:

- Go: `SubmitConversationRating(ctx, conversationID, input) (*SubmitConversationRatingResponse, error)`
- TypeScript/JS: `submitConversationRating(conversationId, input): Promise<SubmitConversationRatingResponse>`
- Python: `submit_conversation_rating(conversation_id, input) -> SubmitConversationRatingResponse`
- Java: `submitConversationRating(conversationId, input) -> SubmitConversationRatingResponse`
- .NET: `SubmitConversationRatingAsync(conversationId, input, ct) -> Task<SubmitConversationRatingResponse>`

Design constraints:

- synchronous call path (user-facing action)
- short retry for transient transport errors
- HTTP transport only
- same auth/tenant config model already used by generation ingest
- no annotation SDK APIs in this phase

## Observability

- `sigil_conversation_ratings_total{rating,status}`
- `sigil_conversation_rating_requests_total{transport,status}`
- `sigil_conversation_rating_request_duration_seconds{transport,operation}`
- `sigil_conversation_annotations_total{annotation_type,status}`
- `sigil_conversation_annotation_requests_total{status}`
- `sigil_conversation_annotation_request_duration_seconds{operation}`

## Security and privacy

- All paths remain tenant-scoped via `X-Scope-OrgID`.
- Operator identity is sourced from Grafana/plugin context for annotation writes.
- Comments and annotation text are user-generated and stored as-is in v1.
- Future retention/redaction/deletion policies are out of scope here.

## Alternatives considered

### One unified feedback API with kind field

Rejected for v1 because user/SDK and operator workflows have different trust, identity, and lifecycle expectations. Separate APIs keep contracts explicit and simpler.

### Annotation APIs in SDKs

Rejected because operator annotations are tied to Sigil/Grafana workflows and authenticated UI user context.

## Risks and mitigations

- Duplicate submissions under retry:
  - mitigated via required idempotency ids.
- Confusing quality semantics:
  - mitigated by using ratings only for bad flags.
- Operator spoofing:
  - mitigated by taking actor identity from plugin-injected headers.

## Rollout

1. Ship ratings API and storage path behind `SIGIL_CONVERSATION_RATINGS_ENABLED`.
2. Ship SDK ratings APIs across all SDKs.
3. Ship annotations API and plugin proxy integration behind `SIGIL_CONVERSATION_ANNOTATIONS_ENABLED`.
4. Enable conversation list filters and detail timelines.

## Out of scope

- LLM-as-judge evaluation pipelines.
- Auto-classification of annotation content.
- Annotation/ratings retention and deletion workflows.
