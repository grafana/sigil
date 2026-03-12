package storage

import (
	"context"
	"fmt"
	"testing"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var (
	fanOutBenchmarkGenerationSink  *sigilv1.Generation
	fanOutBenchmarkGenerationsSink []*sigilv1.Generation
)

func BenchmarkFanOutQuery(b *testing.B) {
	fixture := newFanOutBenchmarkFixture(b, 512, 512, 256)
	store := NewFanOutStore(fixture.walReader, fixture.blockMetadataStore, fixture.blockReader)
	ctx := context.Background()

	b.Run("list_conversation_generations", func(b *testing.B) {
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			generations, err := store.ListConversationGenerations(ctx, fixture.tenantID, fixture.conversationID)
			if err != nil {
				b.Fatalf("list conversation generations: %v", err)
			}
			if len(generations) != fixture.expectedMergedCount {
				b.Fatalf("unexpected merged count: got=%d want=%d", len(generations), fixture.expectedMergedCount)
			}
			fanOutBenchmarkGenerationsSink = generations
		}
	})

	b.Run("get_generation_by_id_hot_hit", func(b *testing.B) {
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			generation, err := store.GetGenerationByID(ctx, fixture.tenantID, fixture.hotGenerationID)
			if err != nil {
				b.Fatalf("get generation by id (hot): %v", err)
			}
			if generation == nil || generation.GetId() != fixture.hotGenerationID {
				b.Fatalf("unexpected hot generation result: %#v", generation)
			}
			fanOutBenchmarkGenerationSink = generation
		}
	})

	b.Run("get_generation_by_id_cold_fallback", func(b *testing.B) {
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			generation, err := store.GetGenerationByID(ctx, fixture.tenantID, fixture.coldGenerationID)
			if err != nil {
				b.Fatalf("get generation by id (cold): %v", err)
			}
			if generation == nil || generation.GetId() != fixture.coldGenerationID {
				b.Fatalf("unexpected cold generation result: %#v", generation)
			}
			fanOutBenchmarkGenerationSink = generation
		}
	})
}

type fanOutBenchmarkFixture struct {
	tenantID            string
	conversationID      string
	hotGenerationID     string
	coldGenerationID    string
	expectedMergedCount int
	walReader           *fanOutBenchmarkWALReader
	blockMetadataStore  *fanOutBenchmarkBlockMetadataStore
	blockReader         *fanOutBenchmarkBlockReader
}

func newFanOutBenchmarkFixture(b *testing.B, hotCount, coldCount, overlap int) fanOutBenchmarkFixture {
	b.Helper()
	if hotCount <= 0 || coldCount <= 0 {
		b.Fatalf("hotCount and coldCount must be positive")
	}
	if overlap < 0 || overlap > hotCount || overlap > coldCount {
		b.Fatalf("invalid overlap: %d", overlap)
	}

	const (
		tenantID       = "tenant-bench"
		conversationID = "conv-bench"
		blockID        = "block-bench-1"
	)

	base := time.Date(2026, 2, 19, 12, 0, 0, 0, time.UTC)

	hotByID := make(map[string]*sigilv1.Generation, hotCount)
	hotList := make([]*sigilv1.Generation, 0, hotCount)
	for i := 0; i < hotCount; i++ {
		generationID := fmt.Sprintf("gen-%04d", i)
		generation := fanOutBenchmarkGeneration(generationID, conversationID, base.Add(time.Duration(i)*time.Millisecond))
		hotByID[generationID] = generation
		hotList = append(hotList, generation)
	}

	coldList := make([]*sigilv1.Generation, 0, coldCount)
	coldByID := make(map[string]*sigilv1.Generation, coldCount)
	for i := 0; i < coldCount; i++ {
		var generationID string
		if i < overlap {
			// Overlap IDs with the tail of hot storage to exercise hot preference.
			generationID = fmt.Sprintf("gen-%04d", hotCount-overlap+i)
		} else {
			generationID = fmt.Sprintf("gen-%04d", hotCount+(i-overlap))
		}
		generation := fanOutBenchmarkGeneration(generationID, conversationID, base.Add(-time.Hour+time.Duration(i)*time.Millisecond))
		coldByID[generationID] = generation
		coldList = append(coldList, generation)
	}

	index := &BlockIndex{Entries: make([]IndexEntry, 0, len(coldList))}
	generationsByOffset := make(map[int64]*sigilv1.Generation, len(coldList))
	for i, generation := range coldList {
		offset := int64(i + 1)
		index.Entries = append(index.Entries, IndexEntry{
			GenerationIDHash:   hashID(generation.GetId()),
			ConversationIDHash: hashID(conversationID),
			Timestamp:          GenerationTimestamp(generation),
			Offset:             offset,
			Length:             1,
		})
		generationsByOffset[offset] = generation
	}

	coldGenerationID := fmt.Sprintf("gen-%04d", hotCount)
	if _, ok := coldByID[coldGenerationID]; !ok {
		// Fallback to the first cold-only ID if the straightforward ID is absent.
		for generationID := range coldByID {
			if _, hotExists := hotByID[generationID]; !hotExists {
				coldGenerationID = generationID
				break
			}
		}
	}

	return fanOutBenchmarkFixture{
		tenantID:            tenantID,
		conversationID:      conversationID,
		hotGenerationID:     "gen-0000",
		coldGenerationID:    coldGenerationID,
		expectedMergedCount: hotCount + coldCount - overlap,
		walReader: &fanOutBenchmarkWALReader{
			byID:           hotByID,
			byConversation: map[string][]*sigilv1.Generation{conversationID: hotList},
		},
		blockMetadataStore: &fanOutBenchmarkBlockMetadataStore{
			blocks: []BlockMeta{{TenantID: tenantID, BlockID: blockID}},
		},
		blockReader: &fanOutBenchmarkBlockReader{
			indexes:             map[string]*BlockIndex{blockID: index},
			generationsByOffset: map[string]map[int64]*sigilv1.Generation{blockID: generationsByOffset},
		},
	}
}

type fanOutBenchmarkWALReader struct {
	byID           map[string]*sigilv1.Generation
	byConversation map[string][]*sigilv1.Generation
}

func (r *fanOutBenchmarkWALReader) GetByID(_ context.Context, _ string, generationID string) (*sigilv1.Generation, error) {
	return r.byID[generationID], nil
}

func (r *fanOutBenchmarkWALReader) GetByConversationID(_ context.Context, _ string, conversationID string) ([]*sigilv1.Generation, error) {
	return r.byConversation[conversationID], nil
}

type fanOutBenchmarkBlockMetadataStore struct {
	blocks []BlockMeta
}

func (s *fanOutBenchmarkBlockMetadataStore) InsertBlock(_ context.Context, _ BlockMeta) error {
	return nil
}

func (s *fanOutBenchmarkBlockMetadataStore) ListBlocks(_ context.Context, tenantID string, _, _ time.Time) ([]BlockMeta, error) {
	out := make([]BlockMeta, 0, len(s.blocks))
	for _, block := range s.blocks {
		if block.TenantID != tenantID {
			continue
		}
		out = append(out, block)
	}
	return out, nil
}

type fanOutBenchmarkBlockReader struct {
	indexes             map[string]*BlockIndex
	generationsByOffset map[string]map[int64]*sigilv1.Generation
}

func (r *fanOutBenchmarkBlockReader) ReadIndex(_ context.Context, _ string, blockID string) (*BlockIndex, error) {
	return r.indexes[blockID], nil
}

func (r *fanOutBenchmarkBlockReader) ReadGenerations(_ context.Context, _ string, blockID string, entries []IndexEntry) ([]*sigilv1.Generation, error) {
	byOffset := r.generationsByOffset[blockID]
	out := make([]*sigilv1.Generation, 0, len(entries))
	for _, entry := range entries {
		generation, ok := byOffset[entry.Offset]
		if !ok {
			continue
		}
		out = append(out, generation)
	}
	return out, nil
}

func fanOutBenchmarkGeneration(id, conversationID string, completedAt time.Time) *sigilv1.Generation {
	return &sigilv1.Generation{
		Id:             id,
		ConversationId: conversationID,
		CompletedAt:    timestamppb.New(completedAt),
	}
}
