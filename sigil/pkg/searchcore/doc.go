// Package searchcore provides shared conversation-search primitives used by
// both Sigil services and the Grafana plugin backend.
//
// The package is intentionally transport/storage agnostic. It owns:
//   - filter parsing and TraceQL compilation
//   - search cursor/hash pagination helpers
//   - Tempo response grouping helpers for conversation-level search rows
//
// Callers compose these primitives with their own HTTP clients and persistence
// adapters.
package searchcore
