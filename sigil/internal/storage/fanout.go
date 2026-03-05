package storage

import (
	"context"
	"errors"
	"hash/fnv"
	"log/slog"
	"math/rand"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
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

	coldReadConfig  ColdReadConfig
	indexCacheCfg   IndexCacheConfig
	coldIndexTokens chan struct{}
	coldIndexReads  int64
}

type FanOutOption func(*FanOutStore)

func WithColdReadConfig(cfg ColdReadConfig) FanOutOption {
	return func(store *FanOutStore) {
		if store == nil {
			return
		}
		if cfg.TotalBudget > 0 {
			store.coldReadConfig.TotalBudget = cfg.TotalBudget
		}
		if cfg.IndexReadTimeout > 0 {
			store.coldReadConfig.IndexReadTimeout = cfg.IndexReadTimeout
		}
		if cfg.IndexRetries >= 0 {
			store.coldReadConfig.IndexRetries = cfg.IndexRetries
		}
		if cfg.IndexWorkers > 0 {
			store.coldReadConfig.IndexWorkers = cfg.IndexWorkers
		}
		if cfg.IndexMaxInflight > 0 {
			store.coldReadConfig.IndexMaxInflight = cfg.IndexMaxInflight
			store.coldIndexTokens = make(chan struct{}, cfg.IndexMaxInflight)
		}
	}
}

func WithIndexCacheConfig(cfg IndexCacheConfig) FanOutOption {
	return func(store *FanOutStore) {
		if store == nil {
			return
		}
		if !cfg.Enabled {
			return
		}
		store.indexCacheCfg.Enabled = true
		if cfg.TTL > 0 {
			store.indexCacheCfg.TTL = cfg.TTL
		}
		if cfg.MaxBytes > 0 {
			store.indexCacheCfg.MaxBytes = cfg.MaxBytes
		}
	}
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

var queryColdIndexInflight = promauto.NewGauge(prometheus.GaugeOpts{
	Name: "sigil_query_cold_index_inflight",
	Help: "Current in-flight cold index reads across fan-out workers.",
})

var queryColdBlocksScanned = promauto.NewHistogramVec(prometheus.HistogramOpts{
	Name:    "sigil_query_cold_blocks_scanned",
	Help:    "Number of cold blocks scanned per query operation.",
	Buckets: []float64{0, 1, 2, 5, 10, 20, 50, 100, 250, 500},
}, []string{"operation"})

var queryColdIndexReadDuration = promauto.NewHistogram(prometheus.HistogramOpts{
	Name:    "sigil_query_cold_index_read_duration_seconds",
	Help:    "Cold index read duration in seconds, including retries.",
	Buckets: prometheus.DefBuckets,
})

type fanOutGenerationResult struct {
	generation *sigilv1.Generation
	err        error
}

type coldBlockResult struct {
	generations []*sigilv1.Generation
	scanned     bool
	matched     bool
	err         error
}

type indexCacheConfigurator interface {
	SetIndexCacheConfig(cfg IndexCacheConfig)
}

// NewFanOutStore builds a fan-out read store over the provided hot and cold
// storage dependencies. Any dependency may be nil; nil inputs disable that side.
func NewFanOutStore(hotReader WALReader, blockMetadataStore BlockMetadataStore, blockReader BlockReader, options ...FanOutOption) *FanOutStore {
	store := &FanOutStore{
		hotReader:          hotReader,
		blockMetadataStore: blockMetadataStore,
		blockReader:        blockReader,
		logger:             slog.Default(),
		coldReadConfig: ColdReadConfig{
			TotalBudget:      DefaultColdTotalBudget,
			IndexReadTimeout: DefaultColdIndexReadTimeout,
			IndexRetries:     DefaultColdIndexRetries,
			IndexWorkers:     DefaultColdIndexWorkers,
			IndexMaxInflight: DefaultColdIndexMaxInflight,
		},
		indexCacheCfg: IndexCacheConfig{
			Enabled:  true,
			TTL:      DefaultIndexCacheTTL,
			MaxBytes: DefaultIndexCacheMaxBytes,
		},
	}
	store.coldIndexTokens = make(chan struct{}, store.coldReadConfig.IndexMaxInflight)
	for _, option := range options {
		if option == nil {
			continue
		}
		option(store)
	}
	if store.blockReader != nil && store.indexCacheCfg.Enabled {
		if configurable, ok := store.blockReader.(indexCacheConfigurator); ok {
			configurable.SetIndexCacheConfig(store.indexCacheCfg)
		}
	}
	return store
}

// GetGenerationByID returns a generation by ID with hot-row preference.
func (s *FanOutStore) GetGenerationByID(ctx context.Context, tenantID, generationID string) (*sigilv1.Generation, error) {
	return s.GetGenerationByIDWithPlan(ctx, tenantID, generationID, GenerationReadPlan{})
}

// GetGenerationByIDWithPlan is an optimized variant that can use caller hints
// to reduce cold-read amplification.
func (s *FanOutStore) GetGenerationByIDWithPlan(
	ctx context.Context,
	tenantID,
	generationID string,
	plan GenerationReadPlan,
) (*sigilv1.Generation, error) {
	if s == nil {
		return nil, nil
	}
	logger := s.loggerOrDefault()

	fanOutStart := time.Now()
	defer observeFanOutDuration("fanout", fanOutStart)

	hotStart := time.Now()
	var hotResult fanOutGenerationResult
	if s.hotReader != nil {
		generation, err := s.hotReader.GetByID(ctx, tenantID, generationID)
		hotResult = fanOutGenerationResult{generation: generation, err: err}
	} else {
		hotResult = fanOutGenerationResult{}
	}
	observeFanOutDuration("hot", hotStart)
	if hotResult.err != nil {
		observeQueryResolution("get_by_id", "error")
		observeQueryReturnedItems("get_by_id", 0)
		queryColdBlocksScanned.WithLabelValues("get_by_id").Observe(0)
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
		queryColdBlocksScanned.WithLabelValues("get_by_id").Observe(0)
		logger.Debug("fanout get by id resolved from hot storage",
			"tenant_id", tenantID,
			"generation_id", generationID,
		)
		return hotResult.generation, nil
	}

	if !s.hasColdReadPath() {
		observeQueryResolution("get_by_id", "miss")
		observeQueryReturnedItems("get_by_id", 0)
		queryColdBlocksScanned.WithLabelValues("get_by_id").Observe(0)
		return nil, nil
	}

	coldStart := time.Now()
	coldGeneration, scannedBlocks, err := s.readColdGenerationByIDWithPlan(ctx, tenantID, generationID, plan)
	observeFanOutDuration("cold", coldStart)
	queryColdBlocksScanned.WithLabelValues("get_by_id").Observe(float64(scannedBlocks))
	if err != nil {
		observeQueryResolution("get_by_id", "error")
		observeQueryReturnedItems("get_by_id", 0)
		logger.Error("fanout get by id cold read failed",
			"tenant_id", tenantID,
			"generation_id", generationID,
			"cold_scanned_blocks", scannedBlocks,
			"err", err,
		)
		return nil, err
	}
	if coldGeneration != nil {
		observeQueryResolution("get_by_id", "cold")
		observeQueryReturnedItems("get_by_id", 1)
		logger.Debug("fanout get by id resolved from cold storage",
			"tenant_id", tenantID,
			"generation_id", generationID,
			"cold_scanned_blocks", scannedBlocks,
		)
		return coldGeneration, nil
	}
	observeQueryResolution("get_by_id", "miss")
	observeQueryReturnedItems("get_by_id", 0)
	logger.Debug("fanout get by id miss",
		"tenant_id", tenantID,
		"generation_id", generationID,
		"cold_scanned_blocks", scannedBlocks,
	)
	return nil, nil
}

// ListConversationGenerations returns all generations for a conversation with
// deterministic merge semantics: union by generation ID, hot-row preference,
// then ascending timestamp order.
func (s *FanOutStore) ListConversationGenerations(ctx context.Context, tenantID, conversationID string) ([]*sigilv1.Generation, error) {
	return s.ListConversationGenerationsWithPlan(ctx, tenantID, conversationID, ConversationReadPlan{})
}

// ListConversationGenerationsWithPlan is an optimized variant that can use
// caller hints to reduce cold-read amplification.
func (s *FanOutStore) ListConversationGenerationsWithPlan(ctx context.Context, tenantID, conversationID string, plan ConversationReadPlan) ([]*sigilv1.Generation, error) {
	if s == nil {
		return []*sigilv1.Generation{}, nil
	}
	logger := s.loggerOrDefault()

	fanOutStart := time.Now()
	defer observeFanOutDuration("fanout", fanOutStart)

	hotStart := time.Now()
	hotGenerations := []*sigilv1.Generation{}
	if s.hotReader != nil {
		loadedHot, err := s.hotReader.GetByConversationID(ctx, tenantID, conversationID)
		observeFanOutDuration("hot", hotStart)
		if err != nil {
			observeQueryResolution("list_conversation", "error")
			observeQueryReturnedItems("list_conversation", 0)
			logger.Error("fanout list conversation generations hot read failed",
				"tenant_id", tenantID,
				"conversation_id", conversationID,
				"err", err,
			)
			return nil, err
		}
		hotGenerations = loadedHot
	} else {
		observeFanOutDuration("hot", hotStart)
	}

	if !s.hasColdReadPath() {
		merged := mergeGenerationsPreferHot(hotGenerations, nil)
		resolution := "miss"
		if len(merged) > 0 {
			resolution = "hot"
		}
		observeQueryResolution("list_conversation", resolution)
		observeQueryReturnedItems("list_conversation", len(merged))
		return merged, nil
	}

	hotGenerationIDs := uniqueGenerationIDs(hotGenerations)
	hotUniqueCount := len(hotGenerationIDs)
	expected := plan.ExpectedGenerationCount
	if expected > 0 && hotUniqueCount >= expected {
		merged := mergeGenerationsPreferHot(hotGenerations, nil)
		observeQueryResolution("list_conversation", "hot")
		observeQueryReturnedItems("list_conversation", len(merged))
		logger.Debug("fanout list conversation generations completed from hot storage",
			"tenant_id", tenantID,
			"conversation_id", conversationID,
			"hot_count", len(hotGenerations),
			"expected_generation_count", expected,
		)
		return merged, nil
	}

	coldStart := time.Now()
	coldGenerations, scannedBlocks, matchedBlocks, err := s.readColdConversationGenerationsWithPlan(
		ctx,
		tenantID,
		conversationID,
		plan,
		hotGenerationIDs,
		hotUniqueCount,
	)
	observeFanOutDuration("cold", coldStart)
	if err != nil {
		observeQueryResolution("list_conversation", "error")
		observeQueryReturnedItems("list_conversation", 0)
		logger.Error("fanout list conversation generations cold read failed",
			"tenant_id", tenantID,
			"conversation_id", conversationID,
			"err", err,
		)
		return nil, err
	}

	merged := mergeGenerationsPreferHot(hotGenerations, coldGenerations)
	resolution := "miss"
	switch {
	case len(hotGenerations) > 0 && len(coldGenerations) > 0:
		resolution = "merged"
	case len(hotGenerations) > 0:
		resolution = "hot"
	case len(coldGenerations) > 0:
		resolution = "cold"
	}
	observeQueryResolution("list_conversation", resolution)
	observeQueryReturnedItems("list_conversation", len(merged))
	queryColdBlocksScanned.WithLabelValues("list_conversation").Observe(float64(scannedBlocks))
	logger.Debug("fanout list conversation generations completed",
		"tenant_id", tenantID,
		"conversation_id", conversationID,
		"hot_count", len(hotGenerations),
		"cold_count", len(coldGenerations),
		"merged_count", len(merged),
		"cold_scanned_blocks", scannedBlocks,
		"cold_matched_blocks", matchedBlocks,
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

func (s *FanOutStore) readColdGenerationByIDWithPlan(
	ctx context.Context,
	tenantID,
	generationID string,
	plan GenerationReadPlan,
) (*sigilv1.Generation, int, error) {
	if !s.hasColdReadPath() {
		return nil, 0, nil
	}

	from, to := normalizedGenerationPlanRange(plan)
	conversationHint := strings.TrimSpace(plan.ConversationID)
	coldCtx, cancel := withOptionalTimeout(ctx, s.coldReadConfig.TotalBudget)
	defer cancel()

	matched, hintedCandidate, scannedBlocks, err := s.scanColdGenerationByID(coldCtx, tenantID, generationID, from, to, conversationHint)
	if err != nil {
		return nil, scannedBlocks, err
	}
	if matched != nil {
		return matched, scannedBlocks, nil
	}
	// conversation_id hint is advisory; if ID is found with a different
	// conversation, prefer returning the ID match over false negatives.
	if hintedCandidate != nil {
		return hintedCandidate, scannedBlocks, nil
	}
	if !hasGenerationRangeHint(plan) {
		return nil, scannedBlocks, nil
	}

	// Range/at hints are advisory; when the bounded pass misses, retry unbounded
	// to preserve generation-id correctness.
	fallbackCtx, fallbackCancel := withOptionalTimeout(coldCtx, s.coldReadConfig.TotalBudget)
	defer fallbackCancel()
	fallbackGeneration, fallbackHintedCandidate, fallbackScanned, err := s.scanColdGenerationByID(
		fallbackCtx,
		tenantID,
		generationID,
		time.Time{},
		time.Time{},
		conversationHint,
	)
	scannedBlocks += fallbackScanned
	if err != nil {
		return nil, scannedBlocks, err
	}
	if fallbackGeneration != nil {
		return fallbackGeneration, scannedBlocks, nil
	}
	if fallbackHintedCandidate != nil {
		return fallbackHintedCandidate, scannedBlocks, nil
	}
	return nil, scannedBlocks, nil
}

func (s *FanOutStore) scanColdGenerationByID(
	ctx context.Context,
	tenantID,
	generationID string,
	from,
	to time.Time,
	conversationHint string,
) (*sigilv1.Generation, *sigilv1.Generation, int, error) {
	blocks, err := s.blockMetadataStore.ListBlocks(ctx, tenantID, from, to)
	if err != nil {
		return nil, nil, 0, err
	}

	scannedBlocks := 0
	var hintedCandidate *sigilv1.Generation
	for idx := len(blocks) - 1; idx >= 0; idx-- {
		index, err := s.readIndexWithPolicy(ctx, tenantID, blocks[idx].BlockID)
		scannedBlocks++
		if err != nil {
			if errors.Is(err, ErrBlockNotFound) {
				s.loggerOrDefault().Warn("skipping stale block during get-by-id",
					"tenant_id", tenantID,
					"block_id", blocks[idx].BlockID,
				)
				continue
			}
			return nil, nil, scannedBlocks, err
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
			return nil, nil, scannedBlocks, err
		}
		for _, generation := range generations {
			if generation.GetId() != generationID {
				continue
			}
			if conversationHint == "" || generation.GetConversationId() == conversationHint {
				return generation, nil, scannedBlocks, nil
			}
			if hintedCandidate == nil {
				hintedCandidate = generation
			}
		}
	}
	return nil, hintedCandidate, scannedBlocks, nil
}

func (s *FanOutStore) readColdConversationGenerationsWithPlan(
	ctx context.Context,
	tenantID,
	conversationID string,
	plan ConversationReadPlan,
	hotGenerationIDs map[string]struct{},
	hotUniqueCount int,
) ([]*sigilv1.Generation, int, int, error) {
	if !s.hasColdReadPath() {
		return []*sigilv1.Generation{}, 0, 0, nil
	}

	from, to := normalizedPlanRange(plan)
	coldCtx, cancel := withOptionalTimeout(ctx, s.coldReadConfig.TotalBudget)
	defer cancel()

	blocks, err := s.blockMetadataStore.ListBlocks(coldCtx, tenantID, from, to)
	if err != nil {
		return nil, 0, 0, err
	}
	if len(blocks) == 0 {
		return []*sigilv1.Generation{}, 0, 0, nil
	}

	workerCount := s.coldReadConfig.IndexWorkers
	if workerCount <= 0 {
		workerCount = 1
	}
	if workerCount > len(blocks) {
		workerCount = len(blocks)
	}

	jobs := make(chan BlockMeta)
	results := make(chan coldBlockResult, workerCount)
	var wg sync.WaitGroup

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for block := range jobs {
				if coldCtx.Err() != nil {
					return
				}
				result := s.scanConversationBlock(coldCtx, tenantID, conversationID, block)
				select {
				case results <- result:
				case <-coldCtx.Done():
					return
				}
			}
		}()
	}

	go func() {
	producerLoop:
		for idx := len(blocks) - 1; idx >= 0; idx-- {
			if coldCtx.Err() != nil {
				break
			}
			select {
			case jobs <- blocks[idx]:
			case <-coldCtx.Done():
				break producerLoop
			}
		}
		close(jobs)
		wg.Wait()
		close(results)
	}()

	expected := plan.ExpectedGenerationCount
	if hotGenerationIDs == nil {
		hotGenerationIDs = map[string]struct{}{}
	}
	byID := make(map[string]*sigilv1.Generation)
	scannedBlocks := 0
	matchedBlocks := 0
	var firstErr error
	for result := range results {
		if result.scanned {
			scannedBlocks++
		}
		if result.matched {
			matchedBlocks++
		}
		if result.err != nil {
			if errors.Is(result.err, context.Canceled) || errors.Is(result.err, context.DeadlineExceeded) {
				if expected > 0 && len(byID)+hotUniqueCount >= expected {
					continue
				}
			}
			if firstErr == nil {
				firstErr = result.err
				cancel()
			}
			continue
		}
		for _, generation := range result.generations {
			if generation == nil {
				continue
			}
			generationID := strings.TrimSpace(generation.GetId())
			if generationID == "" {
				continue
			}
			if _, hotDuplicate := hotGenerationIDs[generationID]; hotDuplicate {
				continue
			}
			byID[generationID] = generation
		}
		if expected > 0 && len(byID)+hotUniqueCount >= expected {
			cancel()
		}
	}
	if firstErr != nil {
		return nil, scannedBlocks, matchedBlocks, firstErr
	}

	out := make([]*sigilv1.Generation, 0, len(byID))
	for _, generation := range byID {
		out = append(out, generation)
	}
	return out, scannedBlocks, matchedBlocks, nil
}

func (s *FanOutStore) scanConversationBlock(ctx context.Context, tenantID, conversationID string, block BlockMeta) coldBlockResult {
	index, err := s.readIndexWithPolicy(ctx, tenantID, block.BlockID)
	if err != nil {
		if errors.Is(err, ErrBlockNotFound) {
			s.loggerOrDefault().Warn("skipping stale block during list-conversation",
				"tenant_id", tenantID,
				"block_id", block.BlockID,
				"conversation_id", conversationID,
			)
			return coldBlockResult{scanned: true}
		}
		return coldBlockResult{scanned: true, err: err}
	}

	entries := findEntriesByConversationID(index, conversationID)
	if len(entries) == 0 {
		return coldBlockResult{scanned: true}
	}

	generations, err := s.blockReader.ReadGenerations(ctx, tenantID, block.BlockID, entries)
	if err != nil {
		if errors.Is(err, ErrBlockNotFound) {
			s.loggerOrDefault().Warn("skipping stale block during list-conversation read",
				"tenant_id", tenantID,
				"block_id", block.BlockID,
				"conversation_id", conversationID,
			)
			return coldBlockResult{scanned: true}
		}
		return coldBlockResult{scanned: true, err: err}
	}

	filtered := make([]*sigilv1.Generation, 0, len(generations))
	for _, generation := range generations {
		// Block index lookups are hash-based; always re-check IDs to avoid
		// hash-collision bleed.
		if generation.GetConversationId() != conversationID {
			continue
		}
		filtered = append(filtered, generation)
	}
	return coldBlockResult{generations: filtered, scanned: true, matched: len(filtered) > 0}
}

func (s *FanOutStore) readIndexWithPolicy(ctx context.Context, tenantID, blockID string) (*BlockIndex, error) {
	attempts := s.coldReadConfig.IndexRetries + 1
	if attempts < 1 {
		attempts = 1
	}

	var lastErr error
	start := time.Now()
	defer func() {
		queryColdIndexReadDuration.Observe(time.Since(start).Seconds())
	}()

	for attempt := 0; attempt < attempts; attempt++ {
		if ctx.Err() != nil {
			if lastErr != nil {
				return nil, lastErr
			}
			return nil, ctx.Err()
		}

		release, err := s.acquireColdIndexSlot(ctx)
		if err != nil {
			if lastErr != nil {
				return nil, lastErr
			}
			return nil, err
		}

		attemptCtx, cancel := withOptionalTimeout(ctx, s.coldReadConfig.IndexReadTimeout)
		index, readErr := s.blockReader.ReadIndex(attemptCtx, tenantID, blockID)
		cancel()
		release()
		if readErr == nil {
			return index, nil
		}
		if errors.Is(readErr, ErrBlockNotFound) {
			return nil, readErr
		}
		lastErr = readErr
		if attempt+1 >= attempts {
			break
		}
		if sleepErr := sleepWithContext(ctx, retryBackoff(attempt)); sleepErr != nil {
			return nil, sleepErr
		}
	}
	if lastErr == nil {
		lastErr = errors.New("read index failed")
	}
	return nil, lastErr
}

func (s *FanOutStore) acquireColdIndexSlot(ctx context.Context) (func(), error) {
	if s == nil || s.coldIndexTokens == nil {
		return func() {}, nil
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case s.coldIndexTokens <- struct{}{}:
		atomic.AddInt64(&s.coldIndexReads, 1)
		queryColdIndexInflight.Inc()
		return func() {
			<-s.coldIndexTokens
			atomic.AddInt64(&s.coldIndexReads, -1)
			queryColdIndexInflight.Dec()
		}, nil
	}
}

func retryBackoff(attempt int) time.Duration {
	base := 50 + (attempt * 50)
	if base > 250 {
		base = 250
	}
	jitter := rand.Intn(25)
	return time.Duration(base+jitter) * time.Millisecond
}

func sleepWithContext(ctx context.Context, duration time.Duration) error {
	if duration <= 0 {
		return nil
	}
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func normalizedPlanRange(plan ConversationReadPlan) (time.Time, time.Time) {
	from := plan.From.UTC()
	to := plan.To.UTC()
	if to.Before(from) {
		return to, from
	}
	return from, to
}

func normalizedGenerationPlanRange(plan GenerationReadPlan) (time.Time, time.Time) {
	from := plan.From.UTC()
	to := plan.To.UTC()
	if from.IsZero() || to.IsZero() {
		at := plan.At.UTC()
		if at.IsZero() {
			return time.Time{}, time.Time{}
		}
		from = at.Add(-2 * time.Minute)
		to = at.Add(2 * time.Minute)
	}
	if to.Before(from) {
		return to, from
	}
	return from, to
}

func hasGenerationRangeHint(plan GenerationReadPlan) bool {
	if !plan.From.IsZero() && !plan.To.IsZero() {
		return true
	}
	return !plan.At.IsZero()
}

func withOptionalTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, timeout)
}

func uniqueGenerationIDs(generations []*sigilv1.Generation) map[string]struct{} {
	if len(generations) == 0 {
		return map[string]struct{}{}
	}
	byID := make(map[string]struct{}, len(generations))
	for _, generation := range generations {
		if generation == nil {
			continue
		}
		id := strings.TrimSpace(generation.GetId())
		if id == "" {
			continue
		}
		byID[id] = struct{}{}
	}
	return byID
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
