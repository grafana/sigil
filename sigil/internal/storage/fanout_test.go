package storage

import (
	"context"
	"errors"
	"sync/atomic"
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
	coldCalled := false

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
				coldCalled = true
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
	if coldCalled {
		t.Fatalf("expected cold path to be skipped on hot hit")
	}
}

func TestFanOutStoreListConversationGenerationsWithPlanSkipsColdWhenHotComplete(t *testing.T) {
	hotGeneration := fanOutTestGeneration("gen-1", "conv-1", time.Date(2026, 2, 19, 10, 0, 0, 0, time.UTC))
	coldCalled := false

	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByConversationID: func(_ context.Context, _, _ string) ([]*sigilv1.Generation, error) {
				return []*sigilv1.Generation{hotGeneration}, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, _ string, _, _ time.Time) ([]BlockMeta, error) {
				coldCalled = true
				return []BlockMeta{}, nil
			},
		},
		&fanOutTestBlockReader{},
	)

	generations, err := store.ListConversationGenerationsWithPlan(context.Background(), "tenant-a", "conv-1", ConversationReadPlan{
		ExpectedGenerationCount: 1,
	})
	if err != nil {
		t.Fatalf("list conversation generations with plan: %v", err)
	}
	if len(generations) != 1 {
		t.Fatalf("expected one hot generation, got %d", len(generations))
	}
	if coldCalled {
		t.Fatalf("expected cold path to be skipped when hot satisfies expected generation count")
	}
}

func TestFanOutStoreListConversationGenerationsWithPlanStopsAfterRemainingExpectedCount(t *testing.T) {
	base := time.Date(2026, 2, 19, 10, 0, 0, 0, time.UTC)
	hotGeneration1 := fanOutTestGeneration("hot-1", "conv-1", base.Add(1*time.Minute))
	hotGeneration2 := fanOutTestGeneration("hot-2", "conv-1", base.Add(2*time.Minute))
	coldGeneration1 := fanOutTestGeneration("cold-1", "conv-1", base.Add(3*time.Minute))
	coldGeneration2 := fanOutTestGeneration("cold-2", "conv-1", base.Add(4*time.Minute))
	coldGeneration3 := fanOutTestGeneration("cold-3", "conv-1", base.Add(5*time.Minute))

	type blockData struct {
		index       *BlockIndex
		byOffsetMap map[int64]*sigilv1.Generation
	}
	blocks := map[string]blockData{}
	for blockID, generation := range map[string]*sigilv1.Generation{
		"block-a": coldGeneration1,
		"block-b": coldGeneration2,
		"block-c": coldGeneration3,
	} {
		index, byOffset := buildFanOutTestBlock(t, []*sigilv1.Generation{generation})
		blocks[blockID] = blockData{
			index:       index,
			byOffsetMap: byOffset,
		}
	}

	var readIndexCalls int32
	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByConversationID: func(_ context.Context, _, _ string) ([]*sigilv1.Generation, error) {
				return []*sigilv1.Generation{hotGeneration1, hotGeneration2}, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, _ string, _, _ time.Time) ([]BlockMeta, error) {
				// Fanout scans from end to start, so block-c is scanned first.
				return []BlockMeta{
					{TenantID: "tenant-a", BlockID: "block-a"},
					{TenantID: "tenant-a", BlockID: "block-b"},
					{TenantID: "tenant-a", BlockID: "block-c"},
				}, nil
			},
		},
		&fanOutTestBlockReader{
			readIndex: func(_ context.Context, _, blockID string) (*BlockIndex, error) {
				atomic.AddInt32(&readIndexCalls, 1)
				data, ok := blocks[blockID]
				if !ok {
					return nil, errors.New("unknown block")
				}
				return data.index, nil
			},
			readGenerations: func(_ context.Context, _, blockID string, entries []IndexEntry) ([]*sigilv1.Generation, error) {
				data, ok := blocks[blockID]
				if !ok {
					return nil, errors.New("unknown block")
				}
				return fanOutGenerationsFromEntries(entries, data.byOffsetMap), nil
			},
		},
		WithColdReadConfig(ColdReadConfig{
			TotalBudget:      time.Second,
			IndexReadTimeout: time.Second,
			IndexRetries:     0,
			IndexWorkers:     1,
			IndexMaxInflight: 1,
		}),
	)

	merged, err := store.ListConversationGenerationsWithPlan(context.Background(), "tenant-a", "conv-1", ConversationReadPlan{
		ExpectedGenerationCount: 3,
	})
	if err != nil {
		t.Fatalf("list conversation generations with plan: %v", err)
	}

	if len(merged) != 3 {
		t.Fatalf("expected merged generation count 3, got %d", len(merged))
	}
	if calls := atomic.LoadInt32(&readIndexCalls); calls >= 3 {
		t.Fatalf("expected early cold stop before scanning 3 blocks, got %d scans", calls)
	}
}

func TestFanOutStoreListConversationGenerationsWithPlanDoesNotHangOnCancelDuringJobSend(t *testing.T) {
	base := time.Date(2026, 2, 19, 10, 0, 0, 0, time.UTC)
	coldGeneration := fanOutTestGeneration("cold-1", "conv-1", base.Add(time.Minute))
	indexWithMatch, generationsByOffset := buildFanOutTestBlock(t, []*sigilv1.Generation{coldGeneration})

	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByConversationID: func(_ context.Context, _, _ string) ([]*sigilv1.Generation, error) {
				return []*sigilv1.Generation{}, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, _ string, _, _ time.Time) ([]BlockMeta, error) {
				// Fanout scans from end to start, so block-matching is dispatched first.
				// The second send can race with cancellation once expected count is reached.
				return []BlockMeta{
					{TenantID: "tenant-a", BlockID: "block-extra"},
					{TenantID: "tenant-a", BlockID: "block-matching"},
				}, nil
			},
		},
		&fanOutTestBlockReader{
			readIndex: func(_ context.Context, _, blockID string) (*BlockIndex, error) {
				if blockID == "block-matching" {
					// Keep worker busy so producer attempts second send while this block is in flight.
					time.Sleep(75 * time.Millisecond)
					return indexWithMatch, nil
				}
				return &BlockIndex{Entries: []IndexEntry{}}, nil
			},
			readGenerations: func(_ context.Context, _, blockID string, entries []IndexEntry) ([]*sigilv1.Generation, error) {
				if blockID == "block-matching" {
					return fanOutGenerationsFromEntries(entries, generationsByOffset), nil
				}
				return []*sigilv1.Generation{}, nil
			},
		},
		WithColdReadConfig(ColdReadConfig{
			TotalBudget:      time.Second,
			IndexReadTimeout: time.Second,
			IndexRetries:     0,
			IndexWorkers:     1,
			IndexMaxInflight: 1,
		}),
	)

	done := make(chan struct{})
	var (
		merged []*sigilv1.Generation
		err    error
	)
	go func() {
		merged, err = store.ListConversationGenerationsWithPlan(
			context.Background(),
			"tenant-a",
			"conv-1",
			ConversationReadPlan{ExpectedGenerationCount: 1},
		)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("list conversation generations with plan hung while producer was sending jobs")
	}

	if err != nil {
		t.Fatalf("list conversation generations with plan: %v", err)
	}
	if len(merged) != 1 || merged[0].GetId() != "cold-1" {
		t.Fatalf("expected one cold generation, got %#v", merged)
	}
}

func TestFanOutStoreAcquireColdIndexSlotTracksInflightCounter(t *testing.T) {
	store := NewFanOutStore(nil, nil, nil)
	gaugeBefore := testutil.ToFloat64(queryColdIndexInflight)

	release1, err := store.acquireColdIndexSlot(context.Background())
	if err != nil {
		t.Fatalf("acquire first slot: %v", err)
	}
	release2, err := store.acquireColdIndexSlot(context.Background())
	if err != nil {
		t.Fatalf("acquire second slot: %v", err)
	}

	if inflight := atomic.LoadInt64(&store.coldIndexReads); inflight != 2 {
		t.Fatalf("expected inflight counter=2 after two acquires, got %d", inflight)
	}
	if gauge := testutil.ToFloat64(queryColdIndexInflight); gauge != gaugeBefore+2 {
		t.Fatalf("expected inflight gauge=%v after two acquires, got %v", gaugeBefore+2, gauge)
	}

	release1()
	if inflight := atomic.LoadInt64(&store.coldIndexReads); inflight != 1 {
		t.Fatalf("expected inflight counter=1 after one release, got %d", inflight)
	}
	if gauge := testutil.ToFloat64(queryColdIndexInflight); gauge != gaugeBefore+1 {
		t.Fatalf("expected inflight gauge=%v after one release, got %v", gaugeBefore+1, gauge)
	}

	release2()
	if inflight := atomic.LoadInt64(&store.coldIndexReads); inflight != 0 {
		t.Fatalf("expected inflight counter=0 after releases, got %d", inflight)
	}
	if gauge := testutil.ToFloat64(queryColdIndexInflight); gauge != gaugeBefore {
		t.Fatalf("expected inflight gauge=%v after releases, got %v", gaugeBefore, gauge)
	}
}

func TestFanOutStoreGetGenerationByIDWithPlanUsesBoundedBlockRange(t *testing.T) {
	var (
		capturedFrom time.Time
		capturedTo   time.Time
	)
	planFrom := time.Date(2026, 2, 19, 9, 0, 0, 0, time.UTC)
	planTo := time.Date(2026, 2, 19, 11, 0, 0, 0, time.UTC)

	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByID: func(_ context.Context, _, _ string) (*sigilv1.Generation, error) {
				return nil, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, _ string, from, to time.Time) ([]BlockMeta, error) {
				if capturedFrom.IsZero() && capturedTo.IsZero() && (!from.IsZero() || !to.IsZero()) {
					capturedFrom = from
					capturedTo = to
				}
				return []BlockMeta{}, nil
			},
		},
		&fanOutTestBlockReader{},
	)

	_, err := store.GetGenerationByIDWithPlan(context.Background(), "tenant-a", "gen-1", GenerationReadPlan{
		From: planFrom,
		To:   planTo,
	})
	if err != nil {
		t.Fatalf("get generation by id with plan: %v", err)
	}
	if !capturedFrom.Equal(planFrom) {
		t.Fatalf("expected block range from %s, got %s", planFrom, capturedFrom)
	}
	if !capturedTo.Equal(planTo) {
		t.Fatalf("expected block range to %s, got %s", planTo, capturedTo)
	}
}

func TestFanOutStoreGetGenerationByIDWithPlanTreatsConversationHintAsAdvisory(t *testing.T) {
	generation := fanOutTestGeneration("gen-1", "conv-other", time.Date(2026, 2, 19, 10, 0, 0, 0, time.UTC))
	index, generationsByOffset := buildFanOutTestBlock(t, []*sigilv1.Generation{generation})

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

	found, err := store.GetGenerationByIDWithPlan(context.Background(), "tenant-a", "gen-1", GenerationReadPlan{
		ConversationID: "conv-target",
	})
	if err != nil {
		t.Fatalf("get generation by id with conversation hint: %v", err)
	}
	if found == nil || found.GetId() != "gen-1" {
		t.Fatalf("expected advisory hint to still return generation id match, got %#v", found)
	}
}

func TestFanOutStoreGetGenerationByIDWithPlanFallsBackWhenRangeHintMisses(t *testing.T) {
	generation := fanOutTestGeneration("gen-1", "conv-1", time.Date(2026, 2, 19, 10, 0, 0, 0, time.UTC))
	index, generationsByOffset := buildFanOutTestBlock(t, []*sigilv1.Generation{generation})

	var listCalls int32
	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByID: func(_ context.Context, _, _ string) (*sigilv1.Generation, error) {
				return nil, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, _ string, from, to time.Time) ([]BlockMeta, error) {
				call := atomic.AddInt32(&listCalls, 1)
				if call == 1 {
					if from.IsZero() || to.IsZero() {
						t.Fatalf("expected bounded first call for range hint, got from=%s to=%s", from, to)
					}
					// Simulate a bad hint range that excludes the real block.
					return []BlockMeta{}, nil
				}
				if !from.IsZero() || !to.IsZero() {
					t.Fatalf("expected unbounded fallback call, got from=%s to=%s", from, to)
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

	found, err := store.GetGenerationByIDWithPlan(context.Background(), "tenant-a", "gen-1", GenerationReadPlan{
		From: time.Date(2026, 2, 19, 11, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 2, 19, 12, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("get generation by id with range hint: %v", err)
	}
	if found == nil || found.GetId() != "gen-1" {
		t.Fatalf("expected fallback to return generation despite bad range hint, got %#v", found)
	}
	if calls := atomic.LoadInt32(&listCalls); calls != 2 {
		t.Fatalf("expected bounded + fallback list-block calls, got %d", calls)
	}
}

func TestFanOutStoreGetGenerationByIDWithPlanFallbackPreservesConversationHint(t *testing.T) {
	targetGen := fanOutTestGeneration("gen-1", "conv-target", time.Date(2026, 2, 19, 9, 0, 0, 0, time.UTC))
	otherGen := fanOutTestGeneration("gen-1", "conv-other", time.Date(2026, 2, 19, 10, 0, 0, 0, time.UTC))

	indexOlder, offsetsOlder := buildFanOutTestBlock(t, []*sigilv1.Generation{targetGen})
	indexNewer, offsetsNewer := buildFanOutTestBlock(t, []*sigilv1.Generation{otherGen})

	var listCalls int32
	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByID: func(_ context.Context, _, _ string) (*sigilv1.Generation, error) {
				return nil, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, _ string, from, to time.Time) ([]BlockMeta, error) {
				call := atomic.AddInt32(&listCalls, 1)
				if call == 1 {
					return []BlockMeta{}, nil
				}
				return []BlockMeta{
					{TenantID: "tenant-a", BlockID: "block-older"},
					{TenantID: "tenant-a", BlockID: "block-newer"},
				}, nil
			},
		},
		&fanOutTestBlockReader{
			readIndex: func(_ context.Context, _, blockID string) (*BlockIndex, error) {
				if blockID == "block-newer" {
					return indexNewer, nil
				}
				return indexOlder, nil
			},
			readGenerations: func(_ context.Context, _, blockID string, entries []IndexEntry) ([]*sigilv1.Generation, error) {
				if blockID == "block-newer" {
					return fanOutGenerationsFromEntries(entries, offsetsNewer), nil
				}
				return fanOutGenerationsFromEntries(entries, offsetsOlder), nil
			},
		},
	)

	found, err := store.GetGenerationByIDWithPlan(context.Background(), "tenant-a", "gen-1", GenerationReadPlan{
		ConversationID: "conv-target",
		From:           time.Date(2026, 2, 19, 11, 0, 0, 0, time.UTC),
		To:             time.Date(2026, 2, 19, 12, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("get generation by id with range + conversation hint: %v", err)
	}
	if found == nil || found.GetId() != "gen-1" {
		t.Fatalf("expected generation to be found, got %#v", found)
	}
	if found.GetConversationId() != "conv-target" {
		t.Fatalf("expected fallback to preserve conversation hint and prefer conv-target, got conversation_id=%q", found.GetConversationId())
	}
	if calls := atomic.LoadInt32(&listCalls); calls != 2 {
		t.Fatalf("expected bounded + fallback list-block calls, got %d", calls)
	}
}

func TestFanOutStoreGetGenerationByIDWithPlanFallbackPreservesAdvisoryHintedCandidate(t *testing.T) {
	generation := fanOutTestGeneration("gen-1", "conv-other", time.Date(2026, 2, 19, 10, 0, 0, 0, time.UTC))
	index, generationsByOffset := buildFanOutTestBlock(t, []*sigilv1.Generation{generation})

	var listCalls int32
	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByID: func(_ context.Context, _, _ string) (*sigilv1.Generation, error) {
				return nil, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, _ string, from, to time.Time) ([]BlockMeta, error) {
				call := atomic.AddInt32(&listCalls, 1)
				if call == 1 {
					// Simulate a bad range hint that misses the real block.
					if from.IsZero() || to.IsZero() {
						t.Fatalf("expected bounded first call for range hint, got from=%s to=%s", from, to)
					}
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

	found, err := store.GetGenerationByIDWithPlan(context.Background(), "tenant-a", "gen-1", GenerationReadPlan{
		ConversationID: "conv-target",
		From:           time.Date(2026, 2, 19, 11, 0, 0, 0, time.UTC),
		To:             time.Date(2026, 2, 19, 12, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("get generation by id with range + conversation hint: %v", err)
	}
	if found == nil || found.GetId() != "gen-1" {
		t.Fatalf("expected fallback advisory candidate to return generation id match, got %#v", found)
	}
	if calls := atomic.LoadInt32(&listCalls); calls != 2 {
		t.Fatalf("expected bounded + fallback list-block calls, got %d", calls)
	}
}

func TestFanOutStoreGetGenerationByIDWithPlanFallbackSharesColdBudget(t *testing.T) {
	budget := 400 * time.Millisecond
	firstScanSleep := 200 * time.Millisecond

	generation := fanOutTestGeneration("gen-1", "conv-1", time.Date(2026, 2, 19, 10, 0, 0, 0, time.UTC))
	index, generationsByOffset := buildFanOutTestBlock(t, []*sigilv1.Generation{generation})

	var listCalls int32
	var fallbackDeadlineRemaining time.Duration
	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByID: func(_ context.Context, _, _ string) (*sigilv1.Generation, error) {
				return nil, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(ctx context.Context, _ string, from, to time.Time) ([]BlockMeta, error) {
				call := atomic.AddInt32(&listCalls, 1)
				if call == 1 {
					time.Sleep(firstScanSleep)
					return []BlockMeta{}, nil
				}
				if dl, ok := ctx.Deadline(); ok {
					fallbackDeadlineRemaining = time.Until(dl)
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
		WithColdReadConfig(ColdReadConfig{
			TotalBudget:      budget,
			IndexReadTimeout: budget,
			IndexRetries:     0,
			IndexWorkers:     1,
			IndexMaxInflight: 1,
		}),
	)

	found, err := store.GetGenerationByIDWithPlan(context.Background(), "tenant-a", "gen-1", GenerationReadPlan{
		From: time.Date(2026, 2, 19, 11, 0, 0, 0, time.UTC),
		To:   time.Date(2026, 2, 19, 12, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("get generation by id with plan: %v", err)
	}
	if found == nil || found.GetId() != "gen-1" {
		t.Fatalf("expected fallback to return generation, got %#v", found)
	}
	if fallbackDeadlineRemaining <= 0 {
		t.Fatalf("expected fallback context deadline to be set")
	}
	if fallbackDeadlineRemaining > budget-firstScanSleep+50*time.Millisecond {
		t.Fatalf("fallback context should share original cold budget, but had %s remaining (budget=%s, first scan slept %s)",
			fallbackDeadlineRemaining, budget, firstScanSleep)
	}
}

func TestFanOutStoreListConversationGenerationsWithPlanUsesBoundedBlockRange(t *testing.T) {
	var (
		capturedFrom time.Time
		capturedTo   time.Time
	)
	planFrom := time.Date(2026, 2, 19, 9, 0, 0, 0, time.UTC)
	planTo := time.Date(2026, 2, 19, 11, 0, 0, 0, time.UTC)

	store := NewFanOutStore(
		&fanOutTestWALReader{
			getByConversationID: func(_ context.Context, _, _ string) ([]*sigilv1.Generation, error) {
				return []*sigilv1.Generation{}, nil
			},
		},
		&fanOutTestBlockMetadataStore{
			listBlocks: func(_ context.Context, _ string, from, to time.Time) ([]BlockMeta, error) {
				capturedFrom = from
				capturedTo = to
				return []BlockMeta{}, nil
			},
		},
		&fanOutTestBlockReader{},
	)

	_, err := store.ListConversationGenerationsWithPlan(context.Background(), "tenant-a", "conv-1", ConversationReadPlan{
		From: planFrom,
		To:   planTo,
	})
	if err != nil {
		t.Fatalf("list conversation generations with plan: %v", err)
	}
	if !capturedFrom.Equal(planFrom) {
		t.Fatalf("expected block range from %s, got %s", planFrom, capturedFrom)
	}
	if !capturedTo.Equal(planTo) {
		t.Fatalf("expected block range to %s, got %s", planTo, capturedTo)
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
