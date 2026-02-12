package storage

import (
	"context"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

type BlockWriter interface {
	WriteBlock(ctx context.Context, tenantID string, block *Block) error
}

type BlockReader interface {
	ReadIndex(ctx context.Context, tenantID, blockID string) (*BlockIndex, error)
	ReadGenerations(ctx context.Context, tenantID, blockID string, entries []IndexEntry) ([]*sigilv1.Generation, error)
}
