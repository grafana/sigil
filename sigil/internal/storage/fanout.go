package storage

import (
	"context"
	"errors"
	"hash/fnv"
	"log/slog"
	"sort"
	"strings"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// GenerationFanOutReader returns generation reads merged across hot WAL rows
// and cold object-storage blocks.
type GenerationFanOutReader interface {
	GetGenerationByID(ctx context.Context, tenantID, generationID string) (*sigilv1.Generation, error)
	ListConversationGenerations(ctx context.Context, tenantID, conversationID string) ([]*sigilv1.Generation, error)
}

// FanOutStore merges generation reads from hot WAL rows and cold compacted
// blocks. When the same generation exists in both stores, hot rows win.
type FanOutStore struct {
	hotReader          WALReader
	blockMetadataStore BlockMetadataStore
	blockReader        BlockReader
	logger             *slog.Logger
}

var _ GenerationFanOutReader = (*FanOutStore)(nil)

var queryFanOutDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
	Name:    "sigil_query_fanout_duration_seconds",
	Help:    "Fan-out storage read duration partitioned by source (hot, cold, fanout).",
	Buckets: prometheus.DefBuckets,
}, []string{"source"})

var queryResolutionTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "sigil_query_resolution_total",
	Help: "Query read-path resolution outcomes by operation.",
}, []string{"operation", "result"})

var queryReturnedItems = promauto.NewHistogramVec(prometheus.HistogramOpts{
	Name:    "sigil_query_returned_items",
	Help:    "Number of items returned by query operations.",
	Buckets: []float64{0, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000},
}, []string{"operation"})

type fanOutGenerationResult struct {
	generation *sigilv1.Generation
	err        error
}

type fanOutGenerationsResult struct {
	generations []*sigilv1.Generation
	err         error
}

// NewFanOutStore builds a fan-out read store over the provided hot and cold
// storage dependencies. Any dependency may be nil; nil inputs disable that side.
func NewFanOutStore(hotReader WALReader, blockMetadataStore BlockMetadataStore, blockReader BlockReader) *FanOutStore {
	return &FanOutStore{
		hotReader:          hotReader,
		blockMetadataStore: blockMetadataStore,
		blockReader:        blockReader,
		logger:             slog.Default(),
	}
}

// GetGenerationByID returns a generation by ID with hot-row preference. Hot and
// cold reads run in parallel. A cold read error is ignored when hot already has
// the row, because cold is only a fallback in that case.
func (s *FanOutStore) GetGenerationByID(ctx context.Context, tenantID, generationID string) (*sigilv1.Generation, error) {
	if s == nil {
		return nil, nil
	}
	logger := s.loggerOrDefault()

	fanOutStart := time.Now()
	defer observeFanOutDuration("fanout", fanOutStart)

	fanOutCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	hotResultCh := make(chan fanOutGenerationResult, 1)
	coldResultCh := make(chan fanOutGenerationResult, 1)

	if s.hotReader != nil {
		go func() {
			hotStart := time.Now()
			generation, err := s.hotReader.GetByID(fanOutCtx, tenantID, generationID)
			observeFanOutDuration("hot", hotStart)
			hotResultCh <- fanOutGenerationResult{generation: generation, err: err}
		}()
	} else {
		hotResultCh <- fanOutGenerationResult{}
	}

	if s.hasColdReadPath() {
		go func() {
			coldStart := time.Now()
			generation, err := s.readColdGenerationByID(fanOutCtx, tenantID, generationID)
			observeFanOutDuration("cold", coldStart)
			coldResultCh <- fanOutGenerationResult{generation: generation, err: err}
		}()
	} else {
		coldResultCh <- fanOutGenerationResult{}
	}

	hotResult := <-hotResultCh
	if hotResult.err != nil {
		observeQueryResolution("get_by_id", "error")
		observeQueryReturnedItems("get_by_id", 0)
		logger.Error("fanout get by id hot read failed",
			"tenant_id", tenantID,
			"generation_id", generationID,
			"err", hotResult.err,
		)
		return nil, hotResult.err
	}
	if hotResult.generation != nil {
		observeQueryResolution("get_by_id", "hot")
		observeQueryReturnedItems("get_by_id", 1)
		logger.Debug("fanout get by id resolved from hot storage",
			"tenant_id", tenantID,
			"generation_id", generationID,
		)
		return hotResult.generation, nil
	}

	coldResult := <-coldResultCh
	if coldResult.err != nil {
		observeQueryResolution("get_by_id", "error")
		observeQueryReturnedItems("get_by_id", 0)
		logger.Error("fanout get by id cold read failed",
			"tenant_id", tenantID,
			"generation_id", generationID,
			"err", coldResult.err,
		)
		return nil, coldResult.err
	}
	if coldResult.generation != nil {
		observeQueryResolution("get_by_id", "cold")
		observeQueryReturnedItems("get_by_id", 1)
		logger.Debug("fanout get by id resolved from cold storage",
			"tenant_id", tenantID,
			"generation_id", generationID,
		)
		return coldResult.generation, nil
	}
	observeQueryResolution("get_by_id", "miss")
	observeQueryReturnedItems("get_by_id", 0)
	return nil, nil
}

// ListConversationGenerations returns all generations for a conversation with
// deterministic merge semantics: union by generation ID, hot-row preference,
// then ascending timestamp order.
func (s *FanOutStore) ListConversationGenerations(ctx context.Context, tenantID, conversationID string) ([]*sigilv1.Generation, error) {
	if s == nil {
		return []*sigilv1.Generation{}, nil
	}
	logger := s.loggerOrDefault()

	fanOutStart := time.Now()
	defer observeFanOutDuration("fanout", fanOutStart)

	hotResultCh := make(chan fanOutGenerationsResult, 1)
	coldResultCh := make(chan fanOutGenerationsResult, 1)

	if s.hotReader != nil {
		go func() {
			hotStart := time.Now()
			generations, err := s.hotReader.GetByConversationID(ctx, tenantID, conversationID)
			observeFanOutDuration("hot", hotStart)
			hotResultCh <- fanOutGenerationsResult{generations: generations, err: err}
		}()
	} else {
		hotResultCh <- fanOutGenerationsResult{generations: []*sigilv1.Generation{}}
	}

	if s.hasColdReadPath() {
		go func() {
			coldStart := time.Now()
			generations, err := s.readColdConversationGenerations(ctx, tenantID, conversationID)
			observeFanOutDuration("cold", coldStart)
			coldResultCh <- fanOutGenerationsResult{generations: generations, err: err}
		}()
	} else {
		coldResultCh <- fanOutGenerationsResult{generations: []*sigilv1.Generation{}}
	}

	hotResult := <-hotResultCh
	coldResult := <-coldResultCh

	if hotResult.err != nil {
		observeQueryResolution("list_conversation", "error")
		observeQueryReturnedItems("list_conversation", 0)
		logger.Error("fanout list conversation generations hot read failed",
			"tenant_id", tenantID,
			"conversation_id", conversationID,
			"err", hotResult.err,
		)
		return nil, hotResult.err
	}
	if coldResult.err != nil {
		observeQueryResolution("list_conversation", "error")
		observeQueryReturnedItems("list_conversation", 0)
		logger.Error("fanout list conversation generations cold read failed",
			"tenant_id", tenantID,
			"conversation_id", conversationID,
			"err", coldResult.err,
		)
		return nil, coldResult.err
	}

	merged := mergeGenerationsPreferHot(hotResult.generations, coldResult.generations)
	resolution := "miss"
	switch {
	case len(hotResult.generations) > 0 && len(coldResult.generations) > 0:
		resolution = "merged"
	case len(hotResult.generations) > 0:
		resolution = "hot"
	case len(coldResult.generations) > 0:
		resolution = "cold"
	}
	observeQueryResolution("list_conversation", resolution)
	observeQueryReturnedItems("list_conversation", len(merged))
	logger.Debug("fanout list conversation generations completed",
		"tenant_id", tenantID,
		"conversation_id", conversationID,
		"hot_count", len(hotResult.generations),
		"cold_count", len(coldResult.generations),
		"merged_count", len(merged),
	)
	return merged, nil
}

func observeQueryResolution(operation, result string) {
	queryResolutionTotal.WithLabelValues(operation, result).Inc()
}

func observeQueryReturnedItems(operation string, count int) {
	if count < 0 {
		count = 0
	}
	queryReturnedItems.WithLabelValues(operation).Observe(float64(count))
}

func (s *FanOutStore) hasColdReadPath() bool {
	return s != nil && s.blockMetadataStore != nil && s.blockReader != nil
}

func (s *FanOutStore) readColdGenerationByID(ctx context.Context, tenantID, generationID string) (*sigilv1.Generation, error) {
	if !s.hasColdReadPath() {
		return nil, nil
	}

	blocks, err := s.blockMetadataStore.ListBlocks(ctx, tenantID, time.Time{}, time.Time{})
	if err != nil {
		return nil, err
	}
	for idx := len(blocks) - 1; idx >= 0; idx-- {
		index, err := s.blockReader.ReadIndex(ctx, tenantID, blocks[idx].BlockID)
		if err != nil {
			if errors.Is(err, ErrBlockNotFound) {
				s.loggerOrDefault().Warn("skipping stale block during get-by-id",
					"tenant_id", tenantID,
					"block_id", blocks[idx].BlockID,
				)
				continue
			}
			return nil, err
		}
		entries := findEntriesByGenerationID(index, generationID)
		if len(entries) == 0 {
			continue
		}
		generations, err := s.blockReader.ReadGenerations(ctx, tenantID, blocks[idx].BlockID, entries)
		if err != nil {
			if errors.Is(err, ErrBlockNotFound) {
				s.loggerOrDefault().Warn("skipping stale block during get-by-id read",
					"tenant_id", tenantID,
					"block_id", blocks[idx].BlockID,
				)
				continue
			}
			return nil, err
		}
		for _, generation := range generations {
			if generation.GetId() == generationID {
				return generation, nil
			}
		}
	}
	return nil, nil
}

func (s *FanOutStore) readColdConversationGenerations(ctx context.Context, tenantID, conversationID string) ([]*sigilv1.Generation, error) {
	if !s.hasColdReadPath() {
		return []*sigilv1.Generation{}, nil
	}

	blocks, err := s.blockMetadataStore.ListBlocks(ctx, tenantID, time.Time{}, time.Time{})
	if err != nil {
		return nil, err
	}

	out := make([]*sigilv1.Generation, 0)
	for _, block := range blocks {
		index, err := s.blockReader.ReadIndex(ctx, tenantID, block.BlockID)
		if err != nil {
			if errors.Is(err, ErrBlockNotFound) {
				s.loggerOrDefault().Warn("skipping stale block during list-conversation",
					"tenant_id", tenantID,
					"block_id", block.BlockID,
					"conversation_id", conversationID,
				)
				continue
			}
			return nil, err
		}
		entries := findEntriesByConversationID(index, conversationID)
		if len(entries) == 0 {
			continue
		}
		generations, err := s.blockReader.ReadGenerations(ctx, tenantID, block.BlockID, entries)
		if err != nil {
			if errors.Is(err, ErrBlockNotFound) {
				s.loggerOrDefault().Warn("skipping stale block during list-conversation read",
					"tenant_id", tenantID,
					"block_id", block.BlockID,
					"conversation_id", conversationID,
				)
				continue
			}
			return nil, err
		}
		for _, generation := range generations {
			// Block index lookups are hash-based; always re-check IDs to avoid
			// hash-collision bleed.
			if generation.GetConversationId() != conversationID {
				continue
			}
			out = append(out, generation)
		}
	}
	return out, nil
}

func findEntriesByConversationID(index *BlockIndex, conversationID string) []IndexEntry {
	if index == nil || strings.TrimSpace(conversationID) == "" {
		return nil
	}
	conversationHash := hashID(conversationID)
	entries := make([]IndexEntry, 0)
	for _, entry := range index.Entries {
		if entry.ConversationIDHash == conversationHash {
			entries = append(entries, entry)
		}
	}
	return entries
}

func findEntriesByGenerationID(index *BlockIndex, generationID string) []IndexEntry {
	if index == nil || strings.TrimSpace(generationID) == "" {
		return nil
	}
	generationHash := hashID(generationID)
	entries := make([]IndexEntry, 0)
	for _, entry := range index.Entries {
		if entry.GenerationIDHash == generationHash {
			entries = append(entries, entry)
		}
	}
	return entries
}

// hashID matches the block index hash function used by object block encoding.
func hashID(value string) uint64 {
	hasher := fnv.New64a()
	_, _ = hasher.Write([]byte(value))
	return hasher.Sum64()
}

func mergeGenerationsPreferHot(hotGenerations, coldGenerations []*sigilv1.Generation) []*sigilv1.Generation {
	byID := make(map[string]*sigilv1.Generation, len(hotGenerations)+len(coldGenerations))
	for _, generation := range coldGenerations {
		if generation == nil || strings.TrimSpace(generation.GetId()) == "" {
			continue
		}
		byID[generation.GetId()] = generation
	}
	for _, generation := range hotGenerations {
		if generation == nil || strings.TrimSpace(generation.GetId()) == "" {
			continue
		}
		byID[generation.GetId()] = generation
	}

	out := make([]*sigilv1.Generation, 0, len(byID))
	for _, generation := range byID {
		out = append(out, generation)
	}
	sort.SliceStable(out, func(i, j int) bool {
		leftTime := generationTimestamp(out[i])
		rightTime := generationTimestamp(out[j])
		if leftTime.Equal(rightTime) {
			return out[i].GetId() < out[j].GetId()
		}
		return leftTime.Before(rightTime)
	})
	return out
}

func generationTimestamp(generation *sigilv1.Generation) time.Time {
	if generation == nil {
		return time.Time{}
	}
	if completedAt := generation.GetCompletedAt(); completedAt != nil {
		return completedAt.AsTime().UTC()
	}
	if startedAt := generation.GetStartedAt(); startedAt != nil {
		return startedAt.AsTime().UTC()
	}
	return time.Time{}
}

func observeFanOutDuration(source string, start time.Time) {
	queryFanOutDuration.WithLabelValues(source).Observe(time.Since(start).Seconds())
}

func (s *FanOutStore) loggerOrDefault() *slog.Logger {
	if s != nil && s.logger != nil {
		return s.logger
	}
	return slog.Default()
}
