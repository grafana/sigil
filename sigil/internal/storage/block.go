package storage

import (
	"context"
	"errors"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

// ErrBlockNotFound is returned when a block's objects no longer exist in
// storage, typically because the compactor removed them after merging.
var ErrBlockNotFound = errors.New("block not found")

type BlockWriter interface {
	WriteBlock(ctx context.Context, tenantID string, block *Block) error
}

type BlockReader interface {
	ReadIndex(ctx context.Context, tenantID, blockID string) (*BlockIndex, error)
	ReadGenerations(ctx context.Context, tenantID, blockID string, entries []IndexEntry) ([]*sigilv1.Generation, error)
}
