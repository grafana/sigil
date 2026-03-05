package object

import (
	"bytes"
	"container/list"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/thanos-io/objstore"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"golang.org/x/sync/singleflight"
	"google.golang.org/protobuf/proto"
)

var (
	blockOperationsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_block_operations_total",
		Help: "Total number of block operations partitioned by operation and status.",
	}, []string{"op", "status"})
	blockOperationDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sigil_block_operation_duration_seconds",
		Help:    "Block operation duration in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"op"})
	blockBytesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_block_bytes_total",
		Help: "Total number of bytes transferred by block operations.",
	}, []string{"direction"})
	queryColdIndexCacheHitsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "sigil_query_cold_index_cache_hits_total",
		Help: "Total cold index cache hits for object-store index reads.",
	})
	queryColdIndexCacheMissesTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "sigil_query_cold_index_cache_misses_total",
		Help: "Total cold index cache misses for object-store index reads.",
	})
)

const (
	dataFileName  = "data.sigil"
	indexFileName = "index.sigil"

	defaultNotFoundCacheTTL     = 30 * time.Second
	defaultCoalescedReadTimeout = 5 * time.Second
)

var _ storage.BlockWriter = (*Store)(nil)
var _ storage.BlockReader = (*Store)(nil)

var objectStoreTracer = otel.Tracer("github.com/grafana/sigil/storage/object")

type Store struct {
	endpoint   string
	bucketName string
	bucket     objstore.Bucket
	logger     *slog.Logger

	indexReadGroup singleflight.Group

	indexCacheMu      sync.Mutex
	indexCacheEntries map[string]*list.Element
	indexCacheList    *list.List
	indexCacheBytes   int64
	indexCacheCfg     storage.IndexCacheConfig
	notFoundCacheTTL  time.Duration
}

type indexCacheEntry struct {
	key       string
	index     *storage.BlockIndex
	bytes     int64
	notFound  bool
	expiresAt time.Time
}

func NewStore(endpoint string, bucket string) *Store {
	store := &Store{
		endpoint:   endpoint,
		bucketName: bucket,
		logger:     slog.Default(),
	}
	store.setDefaultIndexCacheConfig()
	return store
}

func NewStoreWithBucket(bucketName string, bucket objstore.Bucket) *Store {
	store := &Store{
		bucketName: bucketName,
		bucket:     bucket,
		logger:     slog.Default(),
	}
	store.setDefaultIndexCacheConfig()
	return store
}

func (s *Store) setDefaultIndexCacheConfig() {
	s.indexCacheCfg = storage.IndexCacheConfig{
		Enabled:  true,
		TTL:      storage.DefaultIndexCacheTTL,
		MaxBytes: storage.DefaultIndexCacheMaxBytes,
	}
	s.notFoundCacheTTL = defaultNotFoundCacheTTL
	s.indexCacheEntries = make(map[string]*list.Element)
	s.indexCacheList = list.New()
}

func (s *Store) SetBucket(bucket objstore.Bucket) {
	s.bucket = bucket
}

func (s *Store) SetIndexCacheConfig(cfg storage.IndexCacheConfig) {
	if s == nil {
		return
	}
	s.indexCacheMu.Lock()
	defer s.indexCacheMu.Unlock()

	s.indexCacheCfg = cfg
	if s.indexCacheCfg.TTL <= 0 {
		s.indexCacheCfg.TTL = storage.DefaultIndexCacheTTL
	}
	if s.indexCacheCfg.MaxBytes <= 0 {
		s.indexCacheCfg.MaxBytes = storage.DefaultIndexCacheMaxBytes
	}
	if !s.indexCacheCfg.Enabled {
		s.indexCacheEntries = make(map[string]*list.Element)
		s.indexCacheList = list.New()
		s.indexCacheBytes = 0
		return
	}
	if s.indexCacheEntries == nil {
		s.indexCacheEntries = make(map[string]*list.Element)
	}
	if s.indexCacheList == nil {
		s.indexCacheList = list.New()
	}
	s.evictCacheUntilUnderLimit()
}

func (s *Store) Endpoint() string {
	return s.endpoint
}

func (s *Store) Bucket() string {
	return s.bucketName
}

func (s *Store) WriteBlock(ctx context.Context, tenantID string, block *storage.Block) error {
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeBlockMetrics("write_block", "error", start, 0, "write")
		return errors.New("tenant id is required")
	}
	if block == nil {
		observeBlockMetrics("write_block", "error", start, 0, "write")
		return errors.New("block is required")
	}

	bucket, err := s.getBucket()
	if err != nil {
		observeBlockMetrics("write_block", "error", start, 0, "write")
		return err
	}

	dataBytes, indexBytes, index, err := EncodeBlock(block)
	if err != nil {
		observeBlockMetrics("write_block", "error", start, 0, "write")
		return fmt.Errorf("encode block %q: %w", block.ID, err)
	}

	dataPath, indexPath := BlockObjectPaths(tenantID, block.ID)

	if err := bucket.Upload(ctx, dataPath, bytes.NewReader(dataBytes)); err != nil {
		observeBlockMetrics("write_block", "error", start, 0, "write")
		return fmt.Errorf("upload data object %q: %w", dataPath, err)
	}

	if err := bucket.Upload(ctx, indexPath, bytes.NewReader(indexBytes)); err != nil {
		_ = bucket.Delete(ctx, dataPath)
		observeBlockMetrics("write_block", "error", start, int64(len(dataBytes)), "write")
		return fmt.Errorf("upload index object %q: %w", indexPath, err)
	}

	writtenBytes := int64(len(dataBytes) + len(indexBytes))
	observeBlockMetrics("write_block", "success", start, writtenBytes, "write")
	s.logger.Info("block written",
		"tenant_id", tenantID,
		"block_id", block.ID,
		"generation_count", len(index.Entries),
		"data_path", dataPath,
		"index_path", indexPath,
		"bytes", writtenBytes,
	)

	return nil
}

func (s *Store) ReadIndex(ctx context.Context, tenantID, blockID string) (*storage.BlockIndex, error) {
	ctx, span := objectStoreTracer.Start(ctx, "sigil.storage.object.read_index")
	defer span.End()

	start := time.Now()
	trimmedTenantID := strings.TrimSpace(tenantID)
	trimmedBlockID := strings.TrimSpace(blockID)
	if trimmedTenantID == "" {
		observeBlockMetrics("read_index", "error", start, 0, "read")
		return nil, errors.New("tenant id is required")
	}
	if trimmedBlockID == "" {
		observeBlockMetrics("read_index", "error", start, 0, "read")
		return nil, errors.New("block id is required")
	}

	cacheKey := indexCacheKey(trimmedTenantID, trimmedBlockID)
	span.SetAttributes(
		attribute.String("sigil.tenant.id", trimmedTenantID),
		attribute.String("sigil.block.id", trimmedBlockID),
	)

	if index, notFound, cacheHit := s.getIndexCache(cacheKey); cacheHit {
		queryColdIndexCacheHitsTotal.Inc()
		span.SetAttributes(
			attribute.Bool("sigil.query.cold_index.cache_hit", true),
			attribute.Bool("sigil.query.cold_index.not_found", notFound),
		)
		if notFound {
			err := fmt.Errorf("read index object %q: %w", blockPath(trimmedTenantID, trimmedBlockID, indexFileName), storage.ErrBlockNotFound)
			recordSpanError(span, err)
			observeBlockMetrics("read_index", "not_found", start, 0, "read")
			return nil, err
		}
		observeBlockMetrics("read_index", "success", start, estimatedIndexBytes(index), "read")
		span.SetAttributes(
			attribute.Int("sigil.query.cold_index.entries", len(index.Entries)),
			attribute.Int64("sigil.query.cold_index.bytes", estimatedIndexBytes(index)),
		)
		return index, nil
	}
	queryColdIndexCacheMissesTotal.Inc()
	span.SetAttributes(attribute.Bool("sigil.query.cold_index.cache_hit", false))

	resultCh := s.indexReadGroup.DoChan(cacheKey, func() (any, error) {
		// Run the shared fetch on a detached timeout to avoid one canceled caller
		// failing all coalesced waiters for the same index key.
		coalescedCtx, cancel := context.WithTimeout(context.Background(), defaultCoalescedReadTimeout)
		defer cancel()

		index, readErr := s.readIndexFromBucket(coalescedCtx, start, trimmedTenantID, trimmedBlockID)
		if readErr != nil {
			if errors.Is(readErr, storage.ErrBlockNotFound) {
				s.putNotFoundCache(cacheKey)
			}
			return nil, readErr
		}
		s.putIndexCache(cacheKey, index)
		return index, nil
	})

	var result singleflight.Result
	select {
	case <-ctx.Done():
		err := ctx.Err()
		recordSpanError(span, err)
		return nil, err
	case result = <-resultCh:
	}
	if result.Err != nil {
		recordSpanError(span, result.Err)
		return nil, result.Err
	}

	index, ok := result.Val.(*storage.BlockIndex)
	if !ok || index == nil {
		err := errors.New("unexpected index read result")
		recordSpanError(span, err)
		return nil, err
	}
	span.SetAttributes(
		attribute.Int("sigil.query.cold_index.entries", len(index.Entries)),
		attribute.Int64("sigil.query.cold_index.bytes", estimatedIndexBytes(index)),
	)
	return cloneBlockIndex(index), nil
}

func (s *Store) readIndexFromBucket(ctx context.Context, start time.Time, tenantID, blockID string) (*storage.BlockIndex, error) {
	bucket, err := s.getBucket()
	if err != nil {
		observeBlockMetrics("read_index", "error", start, 0, "read")
		return nil, err
	}

	indexPath := blockPath(tenantID, blockID, indexFileName)
	reader, err := bucket.Get(ctx, indexPath)
	if err != nil {
		status := "error"
		if bucket.IsObjNotFoundErr(err) {
			status = "not_found"
		}
		observeBlockMetrics("read_index", status, start, 0, "read")
		if bucket.IsObjNotFoundErr(err) {
			return nil, fmt.Errorf("read index object %q: %w: %w", indexPath, storage.ErrBlockNotFound, err)
		}
		return nil, fmt.Errorf("read index object %q: %w", indexPath, err)
	}
	defer func() {
		_ = reader.Close()
	}()

	indexBytes, err := io.ReadAll(reader)
	if err != nil {
		observeBlockMetrics("read_index", "error", start, 0, "read")
		return nil, fmt.Errorf("read index object body %q: %w", indexPath, err)
	}

	index, err := DecodeIndex(indexBytes)
	if err != nil {
		observeBlockMetrics("read_index", "error", start, int64(len(indexBytes)), "read")
		return nil, fmt.Errorf("decode index object %q: %w", indexPath, err)
	}

	observeBlockMetrics("read_index", "success", start, int64(len(indexBytes)), "read")
	return index, nil
}

func (s *Store) ReadGenerations(ctx context.Context, tenantID, blockID string, entries []storage.IndexEntry) ([]*sigilv1.Generation, error) {
	ctx, span := objectStoreTracer.Start(ctx, "sigil.storage.object.read_generations")
	defer span.End()

	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeBlockMetrics("read_generations", "error", start, 0, "read")
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(blockID) == "" {
		observeBlockMetrics("read_generations", "error", start, 0, "read")
		return nil, errors.New("block id is required")
	}
	if len(entries) == 0 {
		observeBlockMetrics("read_generations", "success", start, 0, "read")
		span.SetAttributes(attribute.Int("sigil.query.cold_generation_ranges", 0))
		return []*sigilv1.Generation{}, nil
	}

	bucket, err := s.getBucket()
	if err != nil {
		observeBlockMetrics("read_generations", "error", start, 0, "read")
		recordSpanError(span, err)
		return nil, err
	}

	span.SetAttributes(attribute.Int("sigil.query.cold_generation_ranges", len(entries)))
	dataPath := blockPath(tenantID, blockID, dataFileName)
	generations := make([]*sigilv1.Generation, 0, len(entries))
	var bytesRead int64
	for _, entry := range entries {
		if entry.Offset < 0 || entry.Length <= 0 {
			observeBlockMetrics("read_generations", "error", start, bytesRead, "read")
			err := fmt.Errorf("invalid index range offset=%d length=%d", entry.Offset, entry.Length)
			recordSpanError(span, err)
			return nil, err
		}

		reader, err := bucket.GetRange(ctx, dataPath, entry.Offset, entry.Length)
		if err != nil {
			status := "error"
			if bucket.IsObjNotFoundErr(err) {
				status = "not_found"
			}
			observeBlockMetrics("read_generations", status, start, bytesRead, "read")
			if bucket.IsObjNotFoundErr(err) {
				err = fmt.Errorf("read generation range offset=%d length=%d from %q: %w: %w", entry.Offset, entry.Length, dataPath, storage.ErrBlockNotFound, err)
				recordSpanError(span, err)
				return nil, err
			}
			err = fmt.Errorf("read generation range offset=%d length=%d from %q: %w", entry.Offset, entry.Length, dataPath, err)
			recordSpanError(span, err)
			return nil, err
		}

		payload, readErr := io.ReadAll(reader)
		closeErr := reader.Close()
		if readErr != nil {
			observeBlockMetrics("read_generations", "error", start, bytesRead, "read")
			err := fmt.Errorf("read generation range payload: %w", readErr)
			recordSpanError(span, err)
			return nil, err
		}
		if closeErr != nil {
			observeBlockMetrics("read_generations", "error", start, bytesRead, "read")
			err := fmt.Errorf("close generation range reader: %w", closeErr)
			recordSpanError(span, err)
			return nil, err
		}

		var generation sigilv1.Generation
		if err := proto.Unmarshal(payload, &generation); err != nil {
			observeBlockMetrics("read_generations", "error", start, bytesRead, "read")
			err := fmt.Errorf("decode generation payload: %w", err)
			recordSpanError(span, err)
			return nil, err
		}

		bytesRead += int64(len(payload))
		generations = append(generations, &generation)
	}

	observeBlockMetrics("read_generations", "success", start, bytesRead, "read")
	span.SetAttributes(
		attribute.Int("sigil.query.cold_generation_count", len(generations)),
		attribute.Int64("sigil.query.cold_generation_bytes", bytesRead),
	)
	return generations, nil
}

func (s *Store) getBucket() (objstore.Bucket, error) {
	if s.bucket == nil {
		return nil, errors.New("object bucket is not configured")
	}
	return s.bucket, nil
}

func blockPath(tenantID, blockID, filename string) string {
	return fmt.Sprintf("%s/blocks/%s/%s", tenantID, blockID, filename)
}

func BlockObjectPaths(tenantID, blockID string) (dataPath, indexPath string) {
	return blockPath(tenantID, blockID, dataFileName), blockPath(tenantID, blockID, indexFileName)
}

func observeBlockMetrics(op, status string, start time.Time, bytes int64, direction string) {
	blockOperationsTotal.WithLabelValues(op, status).Inc()
	blockOperationDuration.WithLabelValues(op).Observe(time.Since(start).Seconds())
	if bytes > 0 {
		blockBytesTotal.WithLabelValues(direction).Add(float64(bytes))
	}
}

func indexCacheKey(tenantID, blockID string) string {
	return tenantID + "/" + blockID
}

func (s *Store) getIndexCache(key string) (*storage.BlockIndex, bool, bool) {
	if s == nil || !s.indexCacheCfg.Enabled {
		return nil, false, false
	}
	now := time.Now()
	s.indexCacheMu.Lock()
	defer s.indexCacheMu.Unlock()

	element, ok := s.indexCacheEntries[key]
	if !ok {
		return nil, false, false
	}
	entry, ok := element.Value.(*indexCacheEntry)
	if !ok || entry == nil {
		s.removeCacheElementLocked(element)
		return nil, false, false
	}
	if now.After(entry.expiresAt) {
		s.removeCacheElementLocked(element)
		return nil, false, false
	}
	s.indexCacheList.MoveToFront(element)
	return cloneBlockIndex(entry.index), entry.notFound, true
}

func (s *Store) putNotFoundCache(key string) {
	if s == nil || !s.indexCacheCfg.Enabled {
		return
	}
	s.putCacheEntry(&indexCacheEntry{
		key:       key,
		notFound:  true,
		bytes:     1,
		expiresAt: time.Now().Add(s.notFoundCacheTTL),
	})
}

func (s *Store) putIndexCache(key string, index *storage.BlockIndex) {
	if s == nil || !s.indexCacheCfg.Enabled {
		return
	}
	cloned := cloneBlockIndex(index)
	if cloned == nil {
		return
	}
	s.putCacheEntry(&indexCacheEntry{
		key:       key,
		index:     cloned,
		bytes:     estimatedIndexBytes(cloned),
		expiresAt: time.Now().Add(s.indexCacheCfg.TTL),
	})
}

func (s *Store) putCacheEntry(entry *indexCacheEntry) {
	if entry == nil || entry.bytes <= 0 {
		return
	}
	s.indexCacheMu.Lock()
	defer s.indexCacheMu.Unlock()
	if s.indexCacheEntries == nil {
		s.indexCacheEntries = make(map[string]*list.Element)
	}
	if s.indexCacheList == nil {
		s.indexCacheList = list.New()
	}

	if existing, ok := s.indexCacheEntries[entry.key]; ok {
		s.removeCacheElementLocked(existing)
	}
	element := s.indexCacheList.PushFront(entry)
	s.indexCacheEntries[entry.key] = element
	s.indexCacheBytes += entry.bytes
	s.evictCacheUntilUnderLimit()
}

func (s *Store) evictCacheUntilUnderLimit() {
	for s.indexCacheBytes > s.indexCacheCfg.MaxBytes {
		element := s.indexCacheList.Back()
		if element == nil {
			break
		}
		s.removeCacheElementLocked(element)
	}
}

func (s *Store) removeCacheElementLocked(element *list.Element) {
	if element == nil {
		return
	}
	entry, ok := element.Value.(*indexCacheEntry)
	if ok && entry != nil {
		delete(s.indexCacheEntries, entry.key)
		s.indexCacheBytes -= entry.bytes
		if s.indexCacheBytes < 0 {
			s.indexCacheBytes = 0
		}
	}
	s.indexCacheList.Remove(element)
}

func estimatedIndexBytes(index *storage.BlockIndex) int64 {
	if index == nil {
		return 0
	}
	// Approximate in-memory footprint by entry count plus a fixed overhead.
	return int64((len(index.Entries) * 64) + 128)
}

func cloneBlockIndex(index *storage.BlockIndex) *storage.BlockIndex {
	if index == nil {
		return nil
	}
	cloned := &storage.BlockIndex{
		Entries: make([]storage.IndexEntry, len(index.Entries)),
	}
	copy(cloned.Entries, index.Entries)
	return cloned
}

func recordSpanError(span trace.Span, err error) {
	if span == nil || err == nil {
		return
	}
	span.RecordError(err)
	span.SetStatus(codes.Error, err.Error())
}
