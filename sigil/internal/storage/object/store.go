package object

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/thanos-io/objstore"
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
)

const (
	dataFileName  = "data.sigil"
	indexFileName = "index.sigil"
)

var _ storage.BlockWriter = (*Store)(nil)
var _ storage.BlockReader = (*Store)(nil)

type Store struct {
	endpoint   string
	bucketName string
	bucket     objstore.Bucket
	logger     *slog.Logger
}

func NewStore(endpoint string, bucket string) *Store {
	return &Store{
		endpoint:   endpoint,
		bucketName: bucket,
		logger:     slog.Default(),
	}
}

func NewStoreWithBucket(bucketName string, bucket objstore.Bucket) *Store {
	return &Store{
		bucketName: bucketName,
		bucket:     bucket,
		logger:     slog.Default(),
	}
}

func (s *Store) SetBucket(bucket objstore.Bucket) {
	s.bucket = bucket
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

	dataPath := blockPath(tenantID, block.ID, dataFileName)
	indexPath := blockPath(tenantID, block.ID, indexFileName)

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
	start := time.Now()
	if strings.TrimSpace(tenantID) == "" {
		observeBlockMetrics("read_index", "error", start, 0, "read")
		return nil, errors.New("tenant id is required")
	}
	if strings.TrimSpace(blockID) == "" {
		observeBlockMetrics("read_index", "error", start, 0, "read")
		return nil, errors.New("block id is required")
	}

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
		return []*sigilv1.Generation{}, nil
	}

	bucket, err := s.getBucket()
	if err != nil {
		observeBlockMetrics("read_generations", "error", start, 0, "read")
		return nil, err
	}

	dataPath := blockPath(tenantID, blockID, dataFileName)
	generations := make([]*sigilv1.Generation, 0, len(entries))
	var bytesRead int64
	for _, entry := range entries {
		if entry.Offset < 0 || entry.Length <= 0 {
			observeBlockMetrics("read_generations", "error", start, bytesRead, "read")
			return nil, fmt.Errorf("invalid index range offset=%d length=%d", entry.Offset, entry.Length)
		}

		reader, err := bucket.GetRange(ctx, dataPath, entry.Offset, entry.Length)
		if err != nil {
			status := "error"
			if bucket.IsObjNotFoundErr(err) {
				status = "not_found"
			}
			observeBlockMetrics("read_generations", status, start, bytesRead, "read")
			return nil, fmt.Errorf("read generation range offset=%d length=%d from %q: %w", entry.Offset, entry.Length, dataPath, err)
		}

		payload, readErr := io.ReadAll(reader)
		closeErr := reader.Close()
		if readErr != nil {
			observeBlockMetrics("read_generations", "error", start, bytesRead, "read")
			return nil, fmt.Errorf("read generation range payload: %w", readErr)
		}
		if closeErr != nil {
			observeBlockMetrics("read_generations", "error", start, bytesRead, "read")
			return nil, fmt.Errorf("close generation range reader: %w", closeErr)
		}

		var generation sigilv1.Generation
		if err := proto.Unmarshal(payload, &generation); err != nil {
			observeBlockMetrics("read_generations", "error", start, bytesRead, "read")
			return nil, fmt.Errorf("decode generation payload: %w", err)
		}

		bytesRead += int64(len(payload))
		generations = append(generations, &generation)
	}

	observeBlockMetrics("read_generations", "success", start, bytesRead, "read")
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

func observeBlockMetrics(op, status string, start time.Time, bytes int64, direction string) {
	blockOperationsTotal.WithLabelValues(op, status).Inc()
	blockOperationDuration.WithLabelValues(op).Observe(time.Since(start).Seconds())
	if bytes > 0 {
		blockBytesTotal.WithLabelValues(direction).Add(float64(bytes))
	}
}
