# Sigil API

Active contracts exposed by the service:

- OTLP gRPC traces:
  - `opentelemetry.proto.collector.trace.v1.TraceService/Export`
- OTLP HTTP traces: `:4318/v1/traces`
- Generation ingest gRPC:
  - `sigil.v1.GenerationIngestService.ExportGenerations`
- Generation ingest HTTP parity:
  - `POST /api/v1/generations:export`
- Query API:
  - `GET /api/v1/conversations`
  - `GET /api/v1/conversations/{conversation_id}`
  - `GET /api/v1/completions`
  - `GET /api/v1/traces/{trace_id}`
