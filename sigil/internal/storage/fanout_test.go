package storage

import (
	"context"
	"errors"
	"testing"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestFanOutStoreListConversationGenerationsMergesHotAndCold(t *testing.T) {
	base := time.Date(2026, 2, 19, 10, 0, 0, 0, time.UTC)
	hotGeneration1 := fanOutTestGeneration("gen-1", "conv-1", base.Add(time.Minute))
	hotGeneration2 := fanOutTestGeneration("gen-2", "conv-1", base.Add(3*time.Minute))
	coldGeneration2 := fanOutTestGeneration("gen-2", "conv-1", base.Add(2*time.Minute))
	coldGeneration3 := fanOutTestGeneration("gen-3", "conv-1", base.Add(4*time.Minute))

	index, generationsByOffset := buildFanOutTestBlock(t, []*sigilv1.Generation{coldGeneration2, coldGeneration3})

	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByConversationID: func(_ context.Context, tenantID, conversationID string) ([]*sigilv1.Generation, error) {
				if tenantID != "tenant-a" || conversationID != "conv-1" {
					return []*sigilv1.Generation{}, nil
				}
				return []*sigilv1.Generation{hotGeneration1, hotGeneration2}, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, tenantID string, _, _ time.Time) ([]BlockMeta, error) {
				if tenantID != "tenant-a" {
					return []BlockMeta{}, nil
				}
				return []BlockMeta{{TenantID: "tenant-a", BlockID: "block-1"}}, nil
			},
		},
		&fanOutTestBlockReader{
			readIndex: func(_ context.Context, tenantID, blockID string) (*BlockIndex, error) {
				if tenantID != "tenant-a" || blockID != "block-1" {
					return nil, errors.New("unexpected block lookup")
				}
				return index, nil
			},
			readGenerations: func(_ context.Context, tenantID, blockID string, entries []IndexEntry) ([]*sigilv1.Generation, error) {
				if tenantID != "tenant-a" || blockID != "block-1" {
					return nil, errors.New("unexpected block read")
				}
				return fanOutGenerationsFromEntries(entries, generationsByOffset), nil
			},
		},
	)

	generations, err := store.ListConversationGenerations(context.Background(), "tenant-a", "conv-1")
	if err != nil {
		t.Fatalf("list conversation generations: %v", err)
	}
	if len(generations) != 3 {
		t.Fatalf("expected 3 merged generations, got %d", len(generations))
	}
	if generations[0].GetId() != "gen-1" || generations[1].GetId() != "gen-2" || generations[2].GetId() != "gen-3" {
		t.Fatalf("unexpected merged generation ids: %q, %q, %q", generations[0].GetId(), generations[1].GetId(), generations[2].GetId())
	}
	if generations[1] != hotGeneration2 {
		t.Fatalf("expected hot row preference for gen-2")
	}
}

func TestFanOutStoreGetGenerationByIDFallsBackToCold(t *testing.T) {
	base := time.Date(2026, 2, 19, 10, 0, 0, 0, time.UTC)
	coldGeneration := fanOutTestGeneration("gen-cold", "conv-1", base.Add(time.Minute))
	index, generationsByOffset := buildFanOutTestBlock(t, []*sigilv1.Generation{coldGeneration})

	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByID: func(_ context.Context, _, _ string) (*sigilv1.Generation, error) {
				return nil, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, tenantID string, _, _ time.Time) ([]BlockMeta, error) {
				if tenantID != "tenant-a" {
					return []BlockMeta{}, nil
				}
				return []BlockMeta{{TenantID: "tenant-a", BlockID: "block-1"}}, nil
			},
		},
		&fanOutTestBlockReader{
			readIndex: func(_ context.Context, _, _ string) (*BlockIndex, error) {
				return index, nil
			},
			readGenerations: func(_ context.Context, _, _ string, entries []IndexEntry) ([]*sigilv1.Generation, error) {
				return fanOutGenerationsFromEntries(entries, generationsByOffset), nil
			},
		},
	)

	generation, err := store.GetGenerationByID(context.Background(), "tenant-a", "gen-cold")
	if err != nil {
		t.Fatalf("get generation by id: %v", err)
	}
	if generation == nil || generation.GetId() != "gen-cold" {
		t.Fatalf("expected cold fallback generation, got %#v", generation)
	}
}

func TestFanOutStoreGetGenerationByIDEmitsResolutionMetrics(t *testing.T) {
	base := time.Date(2026, 2, 19, 10, 0, 0, 0, time.UTC)
	coldGeneration := fanOutTestGeneration("gen-metrics", "conv-1", base.Add(time.Minute))
	index, generationsByOffset := buildFanOutTestBlock(t, []*sigilv1.Generation{coldGeneration})

	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByID: func(_ context.Context, _, _ string) (*sigilv1.Generation, error) {
				return nil, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, _ string, _, _ time.Time) ([]BlockMeta, error) {
				return []BlockMeta{{TenantID: "tenant-a", BlockID: "block-1"}}, nil
			},
		},
		&fanOutTestBlockReader{
			readIndex: func(_ context.Context, _, _ string) (*BlockIndex, error) {
				return index, nil
			},
			readGenerations: func(_ context.Context, _, _ string, entries []IndexEntry) ([]*sigilv1.Generation, error) {
				return fanOutGenerationsFromEntries(entries, generationsByOffset), nil
			},
		},
	)

	coldBefore := testutil.ToFloat64(queryResolutionTotal.WithLabelValues("get_by_id", "cold"))
	_, err := store.GetGenerationByID(context.Background(), "tenant-a", "gen-metrics")
	if err != nil {
		t.Fatalf("get generation by id: %v", err)
	}
	coldAfter := testutil.ToFloat64(queryResolutionTotal.WithLabelValues("get_by_id", "cold"))
	if delta := coldAfter - coldBefore; delta != 1 {
		t.Fatalf("expected cold resolution metric increment of 1, got %v", delta)
	}
}

func TestFanOutStoreGetGenerationByIDHotHitIgnoresColdErrors(t *testing.T) {
	hotGeneration := fanOutTestGeneration("gen-hot", "conv-1", time.Date(2026, 2, 19, 10, 1, 0, 0, time.UTC))

	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByID: func(_ context.Context, _, generationID string) (*sigilv1.Generation, error) {
				if generationID == hotGeneration.GetId() {
					return hotGeneration, nil
				}
				return nil, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, _ string, _, _ time.Time) ([]BlockMeta, error) {
				return nil, errors.New("cold storage unavailable")
			},
		},
		&fanOutTestBlockReader{},
	)

	generation, err := store.GetGenerationByID(context.Background(), "tenant-a", hotGeneration.GetId())
	if err != nil {
		t.Fatalf("expected hot hit to ignore cold error, got %v", err)
	}
	if generation != hotGeneration {
		t.Fatalf("expected hot generation pointer, got %#v", generation)
	}
}

func TestFanOutStoreListConversationGenerationsRunsHotAndColdInParallel(t *testing.T) {
	coldStarted := make(chan struct{})

	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByConversationID: func(ctx context.Context, _, _ string) ([]*sigilv1.Generation, error) {
				select {
				case <-coldStarted:
					return []*sigilv1.Generation{}, nil
				case <-ctx.Done():
					return nil, ctx.Err()
				}
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, _ string, _, _ time.Time) ([]BlockMeta, error) {
				close(coldStarted)
				return []BlockMeta{}, nil
			},
		},
		&fanOutTestBlockReader{},
	)

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	generations, err := store.ListConversationGenerations(ctx, "tenant-a", "conv-1")
	if err != nil {
		t.Fatalf("list conversation generations: %v", err)
	}
	if len(generations) != 0 {
		t.Fatalf("expected empty result set, got %d", len(generations))
	}
}

func TestFanOutStoreGetGenerationByIDRunsHotAndColdInParallel(t *testing.T) {
	coldStarted := make(chan struct{})

	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByID: func(ctx context.Context, _, _ string) (*sigilv1.Generation, error) {
				select {
				case <-coldStarted:
					return nil, nil
				case <-ctx.Done():
					return nil, ctx.Err()
				}
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, _ string, _, _ time.Time) ([]BlockMeta, error) {
				close(coldStarted)
				return []BlockMeta{}, nil
			},
		},
		&fanOutTestBlockReader{},
	)

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	generation, err := store.GetGenerationByID(ctx, "tenant-a", "gen-1")
	if err != nil {
		t.Fatalf("get generation by id: %v", err)
	}
	if generation != nil {
		t.Fatalf("expected nil generation, got %#v", generation)
	}
}

func TestFanOutStoreListConversationGenerationsSkipsStaleBlocks(t *testing.T) {
	base := time.Date(2026, 2, 19, 10, 0, 0, 0, time.UTC)
	hotGeneration := fanOutTestGeneration("gen-1", "conv-1", base.Add(time.Minute))

	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByConversationID: func(_ context.Context, _, _ string) ([]*sigilv1.Generation, error) {
				return []*sigilv1.Generation{hotGeneration}, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, _ string, _, _ time.Time) ([]BlockMeta, error) {
				return []BlockMeta{
					{TenantID: "tenant-a", BlockID: "stale-block"},
					{TenantID: "tenant-a", BlockID: "good-block"},
				}, nil
			},
		},
		&fanOutTestBlockReader{
			readIndex: func(_ context.Context, _, blockID string) (*BlockIndex, error) {
				if blockID == "stale-block" {
					return nil, ErrBlockNotFound
				}
				return &BlockIndex{Entries: []IndexEntry{}}, nil
			},
		},
	)

	generations, err := store.ListConversationGenerations(context.Background(), "tenant-a", "conv-1")
	if err != nil {
		t.Fatalf("expected stale block to be skipped, got error: %v", err)
	}
	if len(generations) != 1 || generations[0].GetId() != "gen-1" {
		t.Fatalf("expected 1 hot generation, got %d", len(generations))
	}
}

func TestFanOutStoreGetGenerationByIDSkipsStaleBlocks(t *testing.T) {
	base := time.Date(2026, 2, 19, 10, 0, 0, 0, time.UTC)
	coldGeneration := fanOutTestGeneration("gen-cold", "conv-1", base.Add(time.Minute))
	index, generationsByOffset := buildFanOutTestBlock(t, []*sigilv1.Generation{coldGeneration})

	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByID: func(_ context.Context, _, _ string) (*sigilv1.Generation, error) {
				return nil, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, _ string, _, _ time.Time) ([]BlockMeta, error) {
				return []BlockMeta{
					{TenantID: "tenant-a", BlockID: "good-block"},
					{TenantID: "tenant-a", BlockID: "stale-block"},
				}, nil
			},
		},
		&fanOutTestBlockReader{
			readIndex: func(_ context.Context, _, blockID string) (*BlockIndex, error) {
				if blockID == "stale-block" {
					return nil, ErrBlockNotFound
				}
				return index, nil
			},
			readGenerations: func(_ context.Context, _, _ string, entries []IndexEntry) ([]*sigilv1.Generation, error) {
				return fanOutGenerationsFromEntries(entries, generationsByOffset), nil
			},
		},
	)

	generation, err := store.GetGenerationByID(context.Background(), "tenant-a", "gen-cold")
	if err != nil {
		t.Fatalf("expected stale block to be skipped, got error: %v", err)
	}
	if generation == nil || generation.GetId() != "gen-cold" {
		t.Fatalf("expected cold generation from non-stale block, got %#v", generation)
	}
}

type fanOutTestWALReader struct {
	getByID             func(ctx context.Context, tenantID, generationID string) (*sigilv1.Generation, error)
	getByConversationID func(ctx context.Context, tenantID, conversationID string) ([]*sigilv1.Generation, error)
}

func (r *fanOutTestWALReader) GetByID(ctx context.Context, tenantID, generationID string) (*sigilv1.Generation, error) {
	if r.getByID == nil {
		return nil, nil
	}
	return r.getByID(ctx, tenantID, generationID)
}

func (r *fanOutTestWALReader) GetByConversationID(ctx context.Context, tenantID, conversationID string) ([]*sigilv1.Generation, error) {
	if r.getByConversationID == nil {
		return []*sigilv1.Generation{}, nil
	}
	return r.getByConversationID(ctx, tenantID, conversationID)
}

type fanOutTestBlockMetadataStore struct {
	listBlocks func(ctx context.Context, tenantID string, from, to time.Time) ([]BlockMeta, error)
}

func (s *fanOutTestBlockMetadataStore) InsertBlock(_ context.Context, _ BlockMeta) error {
	return nil
}

func (s *fanOutTestBlockMetadataStore) ListBlocks(ctx context.Context, tenantID string, from, to time.Time) ([]BlockMeta, error) {
	if s.listBlocks == nil {
		return []BlockMeta{}, nil
	}
	return s.listBlocks(ctx, tenantID, from, to)
}

type fanOutTestBlockReader struct {
	readIndex       func(ctx context.Context, tenantID, blockID string) (*BlockIndex, error)
	readGenerations func(ctx context.Context, tenantID, blockID string, entries []IndexEntry) ([]*sigilv1.Generation, error)
}

func (s *fanOutTestBlockReader) ReadIndex(ctx context.Context, tenantID, blockID string) (*BlockIndex, error) {
	if s.readIndex == nil {
		return &BlockIndex{Entries: []IndexEntry{}}, nil
	}
	return s.readIndex(ctx, tenantID, blockID)
}

func (s *fanOutTestBlockReader) ReadGenerations(ctx context.Context, tenantID, blockID string, entries []IndexEntry) ([]*sigilv1.Generation, error) {
	if s.readGenerations == nil {
		return []*sigilv1.Generation{}, nil
	}
	return s.readGenerations(ctx, tenantID, blockID, entries)
}

func fanOutTestGeneration(id, conversationID string, completedAt time.Time) *sigilv1.Generation {
	return &sigilv1.Generation{
		Id:             id,
		ConversationId: conversationID,
		CompletedAt:    timestamppb.New(completedAt),
	}
}

func buildFanOutTestBlock(t *testing.T, generations []*sigilv1.Generation) (*BlockIndex, map[int64]*sigilv1.Generation) {
	t.Helper()
	index := &BlockIndex{Entries: make([]IndexEntry, 0, len(generations))}
	byOffset := make(map[int64]*sigilv1.Generation, len(generations))
	for i, generation := range generations {
		offset := int64(i + 1)
		index.Entries = append(index.Entries, IndexEntry{
			GenerationIDHash:   hashID(generation.GetId()),
			ConversationIDHash: hashID(generation.GetConversationId()),
			Timestamp:          generationTimestamp(generation),
			Offset:             offset,
			Length:             int64(1),
		})
		byOffset[offset] = generation
	}
	return index, byOffset
}

func fanOutGenerationsFromEntries(entries []IndexEntry, byOffset map[int64]*sigilv1.Generation) []*sigilv1.Generation {
	out := make([]*sigilv1.Generation, 0, len(entries))
	for _, entry := range entries {
		generation, ok := byOffset[entry.Offset]
		if !ok {
			continue
		}
		out = append(out, generation)
	}
	return out
}
