package worker

import (
	"context"
	"errors"
	"log/slog"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/internal/storage/object"
)

// NewHotColdGenerationReader wraps a hot-reader with cold-tier fallback.
// The wrapper first checks the hot reader, then scans compacted blocks when the
// generation is missing from WAL.
func NewHotColdGenerationReader(hotReader GenerationReader, blockMetadataStore storage.BlockMetadataStore, blockReader storage.BlockReader) GenerationReader {
	if hotReader == nil {
		return nil
	}
	if blockMetadataStore == nil || blockReader == nil {
		return hotReader
	}
	return &hotColdGenerationReader{
		hotReader:          hotReader,
		blockMetadataStore: blockMetadataStore,
		blockReader:        blockReader,
	}
}

type hotColdGenerationReader struct {
	hotReader          GenerationReader
	blockMetadataStore storage.BlockMetadataStore
	blockReader        storage.BlockReader
}

func (r *hotColdGenerationReader) GetByID(ctx context.Context, tenantID, generationID string) (*sigilv1.Generation, error) {
	generation, err := r.hotReader.GetByID(ctx, tenantID, generationID)
	if err != nil || generation != nil {
		return generation, err
	}

	blocks, err := r.blockMetadataStore.ListBlocks(ctx, tenantID, time.Time{}, time.Time{})
	if err != nil {
		return nil, err
	}

	for idx := len(blocks) - 1; idx >= 0; idx-- {
		index, err := r.blockReader.ReadIndex(ctx, tenantID, blocks[idx].BlockID)
		if err != nil {
			if errors.Is(err, storage.ErrBlockNotFound) {
				slog.Default().Warn("skipping stale block during eval get-by-id",
					"tenant_id", tenantID,
					"block_id", blocks[idx].BlockID,
				)
				continue
			}
			return nil, err
		}
		entries := object.FindEntriesByGenerationID(index, generationID)
		if len(entries) == 0 {
			continue
		}

		generations, err := r.blockReader.ReadGenerations(ctx, tenantID, blocks[idx].BlockID, entries)
		if err != nil {
			if errors.Is(err, storage.ErrBlockNotFound) {
				slog.Default().Warn("skipping stale block during eval get-by-id read",
					"tenant_id", tenantID,
					"block_id", blocks[idx].BlockID,
				)
				continue
			}
			return nil, err
		}
		for _, candidate := range generations {
			// Index lookup is hash-based; re-check IDs to avoid collisions.
			if candidate.GetId() == generationID {
				return candidate, nil
			}
		}
	}

	return nil, nil
}
