// Package mysql implements the MySQL-backed storage layer for Sigil.
//
// It provides the WAL (write-ahead log) store used for generation ingest,
// evaluation configuration (evaluators, rules, templates), and conversation
// storage. The implementation uses GORM for schema management and queries
// against a MySQL 8.x database.
package mysql
