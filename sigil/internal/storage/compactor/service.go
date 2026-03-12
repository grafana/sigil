package compactor

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	"github.com/grafana/dskit/services"
	"github.com/grafana/sigil/sigil/internal/config"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	mysqlstorage "github.com/grafana/sigil/sigil/internal/storage/mysql"
	"google.golang.org/protobuf/proto"
)

const (
	compactPhase  = "compact"
	truncatePhase = "truncate"

	truncateRetryAttempts       = 4
	truncateInitialRetryBackoff = 250 * time.Millisecond
	truncateMaxRetryBackoff     = 2 * time.Second
)

type Service struct {
	cfg     config.CompactorConfig
	logger  log.Logger
	ownerID string

	discoverer TenantDiscoverer
	leaser     TenantLeaser
	claimer    Claimer
	truncator  Truncator

	blockWriter   storage.BlockWriter
	metadataStore storage.BlockMetadataStore
	sleepFn       func(context.Context, time.Duration) error
}

func NewService(
	cfg config.CompactorConfig,
	logger log.Logger,
	ownerID string,
	discoverer TenantDiscoverer,
	leaser TenantLeaser,
	claimer Claimer,
	truncator Truncator,
	blockWriter storage.BlockWriter,
	metadataStore storage.BlockMetadataStore,
) services.Service {
	module := &Service{
		cfg:           cfg,
		logger:        logger,
		ownerID:       strings.TrimSpace(ownerID),
		discoverer:    discoverer,
		leaser:        leaser,
		claimer:       claimer,
		truncator:     truncator,
		blockWriter:   blockWriter,
		metadataStore: metadataStore,
		sleepFn:       sleepWithContext,
	}
	if module.logger == nil {
		module.logger = log.NewNopLogger()
	}
	if module.ownerID == "" {
		module.ownerID = defaultOwnerID()
	}

	return services.NewBasicService(module.start, module.run, module.stop).WithName(config.TargetCompactor)
}

func (s *Service) start(ctx context.Context) error {
	if err := s.validateDependencies(); err != nil {
		return err
	}

	s.runCompactCycle(ctx)
	s.runTruncateCycle(ctx)
	s.runClaimSweep(ctx)
	return nil
}

func (s *Service) run(ctx context.Context) error {
	compactTicker := time.NewTicker(s.cfg.CompactInterval)
	truncateTicker := time.NewTicker(s.cfg.TruncateInterval)
	sweepEvery := s.cfg.ClaimTTL / 2
	if sweepEvery <= 0 {
		sweepEvery = time.Second
	}
	sweepTicker := time.NewTicker(sweepEvery)
	defer compactTicker.Stop()
	defer truncateTicker.Stop()
	defer sweepTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-compactTicker.C:
			s.runCompactCycle(ctx)
		case <-truncateTicker.C:
			s.runTruncateCycle(ctx)
		case <-sweepTicker.C:
			s.runClaimSweep(ctx)
		}
	}
}

func (s *Service) stop(_ error) error {
	return nil
}

func (s *Service) validateDependencies() error {
	switch {
	case s.discoverer == nil:
		return errors.New("discoverer dependency is required")
	case s.leaser == nil:
		return errors.New("leaser dependency is required")
	case s.claimer == nil:
		return errors.New("claimer dependency is required")
	case s.truncator == nil:
		return errors.New("truncator dependency is required")
	case s.blockWriter == nil:
		return errors.New("block writer dependency is required")
	case s.metadataStore == nil:
		return errors.New("metadata store dependency is required")
	}
	return nil
}

func (s *Service) runCompactCycle(ctx context.Context) {
	start := time.Now()
	status := "success"
	defer func() {
		observeRunMetrics(compactPhase, status, start)
	}()

	shards, err := s.discoverer.ListShardsForCompaction(ctx, s.cfg.ShardWindowSeconds, s.cfg.ShardCount, s.discoveryLimit())
	if err != nil {
		status = "error"
		_ = level.Error(s.logger).Log("msg", "compactor shard discovery failed", "phase", compactPhase, "err", err)
		return
	}
	for _, shard := range shards {
		setShardBacklogMetric(shard.TenantID, shard.ShardID, shard.Backlog)
	}

	if err := s.runShardWorkers(ctx, shards, func(workerCtx context.Context, shard storage.TenantShard) error {
		workerStart := time.Now()
		err := s.drainCompactionShard(workerCtx, shard)
		observeDrainDuration(shard.TenantID, shard.ShardID, time.Since(workerStart))
		return err
	}); err != nil {
		status = "error"
		_ = level.Error(s.logger).Log("msg", "compactor shard workers failed", "phase", compactPhase, "err", err)
	}
}

func (s *Service) runTruncateCycle(ctx context.Context) {
	start := time.Now()
	status := "success"
	defer func() {
		observeRunMetrics(truncatePhase, status, start)
	}()

	olderThan := time.Now().UTC().Add(-s.cfg.Retention)
	shards, err := s.discoverer.ListShardsForTruncation(ctx, s.cfg.ShardWindowSeconds, s.cfg.ShardCount, olderThan, s.discoveryLimit())
	if err != nil {
		status = "error"
		_ = level.Error(s.logger).Log("msg", "compactor truncation shard discovery failed", "phase", truncatePhase, "err", err)
		return
	}

	if err := s.runShardWorkers(ctx, shards, func(workerCtx context.Context, shard storage.TenantShard) error {
		return s.truncateShard(workerCtx, shard, olderThan)
	}); err != nil {
		status = "error"
		_ = level.Error(s.logger).Log("msg", "compactor truncation workers failed", "phase", truncatePhase, "err", err)
	}
}

func (s *Service) runClaimSweep(ctx context.Context) {
	start := time.Now()
	recovered, err := s.claimer.ReleaseStaleClaims(ctx, s.cfg.ClaimTTL)
	if err != nil {
		_ = level.Error(s.logger).Log("msg", "compactor stale claim sweep failed", "err", err)
		return
	}
	observeClaimSweep(recovered)
	observeSweepDuration(time.Since(start))
}

// runShardWorkers fans out discovered shards to a bounded worker pool and returns
// the first worker error (if any) after all workers drain.
func (s *Service) runShardWorkers(ctx context.Context, shards []storage.TenantShard, worker func(context.Context, storage.TenantShard) error) error {
	if len(shards) == 0 {
		return nil
	}
	workerCount := s.cfg.Workers
	if workerCount <= 0 {
		workerCount = 1
	}
	if workerCount > len(shards) {
		workerCount = len(shards)
	}

	jobs := make(chan storage.TenantShard, len(shards))
	for _, shard := range shards {
		jobs <- shard
	}
	close(jobs)

	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		firstErr error
	)

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			addWorkerActive(1)
			defer addWorkerActive(-1)

			for shard := range jobs {
				if ctx.Err() != nil {
					return
				}
				if err := worker(ctx, shard); err != nil {
					mu.Lock()
					if firstErr == nil {
						firstErr = err
					}
					mu.Unlock()
					_ = level.Error(s.logger).Log(
						"msg", "compactor worker shard failed",
						"tenant_id", shard.TenantID,
						"shard_id", shard.ShardID,
						"err", err,
					)
				}
			}
		}()
	}

	wg.Wait()
	return firstErr
}

func (s *Service) drainCompactionShard(ctx context.Context, shard storage.TenantShard) error {
	held, currentOwnerID, expiresAt, err := s.leaser.AcquireLease(ctx, shard.TenantID, shard.ShardID, s.ownerID, s.cfg.LeaseTTL)
	if err != nil {
		return fmt.Errorf("acquire lease tenant=%s shard=%d: %w", shard.TenantID, shard.ShardID, err)
	}
	setLeaseMetric(shard.TenantID, shard.ShardID, held)
	if !held {
		_ = level.Debug(s.logger).Log(
			"msg", "compactor shard lease not held",
			"tenant_id", shard.TenantID,
			"shard_id", shard.ShardID,
			"owner_id", s.ownerID,
			"current_owner_id", currentOwnerID,
			"lease_expires_at", expiresAt,
		)
		return nil
	}
	defer setLeaseMetric(shard.TenantID, shard.ShardID, false)

	deadline := time.Now().Add(s.cfg.CycleBudget)
	renewEvery := s.cfg.LeaseTTL / 2
	if renewEvery <= 0 {
		renewEvery = time.Second
	}
	nextRenew := time.Now().Add(renewEvery)
	shardPredicate := s.shardPredicate(shard.ShardID)
	olderThan := time.Now().UTC()

	for {
		if ctx.Err() != nil {
			return nil
		}
		if time.Now().After(deadline) {
			break
		}

		if time.Now().After(nextRenew) {
			renewed, ownerID, renewedExpiresAt, err := s.leaser.RenewLease(ctx, shard.TenantID, shard.ShardID, s.ownerID, s.cfg.LeaseTTL)
			if err != nil {
				return fmt.Errorf("renew lease tenant=%s shard=%d: %w", shard.TenantID, shard.ShardID, err)
			}
			setLeaseMetric(shard.TenantID, shard.ShardID, renewed)
			if !renewed {
				_ = level.Debug(s.logger).Log(
					"msg", "compactor shard lease renewal lost ownership",
					"tenant_id", shard.TenantID,
					"shard_id", shard.ShardID,
					"owner_id", s.ownerID,
					"current_owner_id", ownerID,
					"lease_expires_at", renewedExpiresAt,
				)
				return nil
			}
			nextRenew = time.Now().Add(renewEvery)
		}

		claimed, err := s.claimer.ClaimBatch(ctx, shard.TenantID, s.ownerID, shardPredicate, olderThan, s.cfg.BatchSize)
		if err != nil {
			observeClaimBatch("error")
			return fmt.Errorf("claim batch tenant=%s shard=%d: %w", shard.TenantID, shard.ShardID, err)
		}
		observeClaimBatch("success")

		generations, ids, err := s.claimer.LoadClaimed(ctx, shard.TenantID, s.ownerID, shardPredicate, s.cfg.BatchSize)
		if err != nil {
			return fmt.Errorf("load claimed tenant=%s shard=%d: %w", shard.TenantID, shard.ShardID, err)
		}
		if len(generations) == 0 || len(ids) == 0 {
			if claimed == 0 {
				break
			}
			return fmt.Errorf(
				"claim/load mismatch tenant=%s shard=%d claimed=%d loaded=%d ids=%d",
				shard.TenantID,
				shard.ShardID,
				claimed,
				len(generations),
				len(ids),
			)
		}
		if len(generations) != len(ids) {
			return fmt.Errorf(
				"load claimed returned mismatched rows tenant=%s shard=%d generations=%d ids=%d",
				shard.TenantID,
				shard.ShardID,
				len(generations),
				len(ids),
			)
		}

		rows := make([]claimedRow, 0, len(generations))
		for i, generation := range generations {
			rows = append(rows, claimedRow{
				ID:   ids[i],
				Gen:  generation,
				Size: int64(proto.Size(generation)),
			})
		}

		for len(rows) > 0 {
			// Keep block sizes bounded while still draining the full claimed batch.
			flushRows, remaining := splitRowsByTarget(rows, s.cfg.TargetBlockBytes)
			if err := s.writeAndFinalize(ctx, shard.TenantID, flushRows); err != nil {
				return err
			}
			rows = remaining
		}

		// Continue while either newly claimed work or previously-owned claimed rows
		// still return full batches.
		if claimed < s.cfg.BatchSize && len(generations) < s.cfg.BatchSize {
			break
		}
	}

	if err := s.truncateOwnedShard(ctx, shard, time.Now().UTC().Add(-s.cfg.Retention), deadline, nextRenew, renewEvery); err != nil {
		return err
	}
	return nil
}

func (s *Service) truncateShard(ctx context.Context, shard storage.TenantShard, olderThan time.Time) error {
	held, currentOwnerID, expiresAt, err := s.leaser.AcquireLease(ctx, shard.TenantID, shard.ShardID, s.ownerID, s.cfg.LeaseTTL)
	if err != nil {
		return fmt.Errorf("acquire truncation lease tenant=%s shard=%d: %w", shard.TenantID, shard.ShardID, err)
	}
	setLeaseMetric(shard.TenantID, shard.ShardID, held)
	if !held {
		_ = level.Debug(s.logger).Log(
			"msg", "compactor truncation lease not held",
			"tenant_id", shard.TenantID,
			"shard_id", shard.ShardID,
			"owner_id", s.ownerID,
			"current_owner_id", currentOwnerID,
			"lease_expires_at", expiresAt,
		)
		return nil
	}
	defer setLeaseMetric(shard.TenantID, shard.ShardID, false)

	renewEvery := s.cfg.LeaseTTL / 2
	if renewEvery <= 0 {
		renewEvery = time.Second
	}
	nextRenew := time.Now().Add(renewEvery)
	deadline := time.Now().Add(s.cfg.CycleBudget)
	return s.truncateOwnedShard(ctx, shard, olderThan, deadline, nextRenew, renewEvery)
}

func (s *Service) truncateOwnedShard(ctx context.Context, shard storage.TenantShard, olderThan time.Time, deadline time.Time, nextRenew time.Time, renewEvery time.Duration) error {
	shardPredicate := s.shardPredicate(shard.ShardID)

	for {
		if ctx.Err() != nil {
			return nil
		}
		if time.Now().After(deadline) {
			return nil
		}
		if time.Now().After(nextRenew) {
			renewed, ownerID, renewedExpiresAt, err := s.leaser.RenewLease(ctx, shard.TenantID, shard.ShardID, s.ownerID, s.cfg.LeaseTTL)
			if err != nil {
				return fmt.Errorf("renew truncation lease tenant=%s shard=%d: %w", shard.TenantID, shard.ShardID, err)
			}
			setLeaseMetric(shard.TenantID, shard.ShardID, renewed)
			if !renewed {
				_ = level.Debug(s.logger).Log(
					"msg", "compactor truncation lease renewal lost ownership",
					"tenant_id", shard.TenantID,
					"shard_id", shard.ShardID,
					"owner_id", s.ownerID,
					"current_owner_id", ownerID,
					"lease_expires_at", renewedExpiresAt,
				)
				return nil
			}
			nextRenew = time.Now().Add(renewEvery)
		}

		deleted, usedLimit, err := s.truncateCompactedWithRetry(ctx, shard, shardPredicate, olderThan, deadline)
		if err != nil {
			return fmt.Errorf("truncate compacted tenant=%s shard=%d: %w", shard.TenantID, shard.ShardID, err)
		}
		observeTruncated(deleted)
		if deleted < int64(usedLimit) {
			return nil
		}
	}
}

func (s *Service) truncateCompactedWithRetry(
	ctx context.Context,
	shard storage.TenantShard,
	shardPredicate storage.ShardPredicate,
	olderThan time.Time,
	deadline time.Time,
) (int64, int, error) {
	limit := s.cfg.BatchSize
	backoff := truncateInitialRetryBackoff
	retries := 0

	for {
		deleted, err := s.truncator.TruncateCompacted(ctx, shard.TenantID, shardPredicate, olderThan, limit)
		if err == nil {
			if retries > 0 {
				observeTruncateDeadlock("recovered")
				_ = level.Info(s.logger).Log(
					"msg", "compactor truncation recovered after retryable MySQL lock error",
					"tenant_id", shard.TenantID,
					"shard_id", shard.ShardID,
					"retries", retries,
					"retry_limit", limit,
				)
			}
			return deleted, limit, nil
		}
		if !mysqlstorage.IsRetryableLockError(err) {
			return 0, limit, err
		}

		observeTruncateDeadlock("retry")
		retries++
		if retries > truncateRetryAttempts || time.Now().After(deadline) {
			observeTruncateDeadlock("exhausted")
			return 0, limit, fmt.Errorf("retryable MySQL lock error exhausted after %d retries: %w", retries, err)
		}

		if limit > 1 {
			limit /= 2
			if limit < 1 {
				limit = 1
			}
		}

		sleepFor := backoff
		if remaining := time.Until(deadline); remaining < sleepFor {
			sleepFor = remaining
		}
		if sleepFor > 0 {
			if err := s.sleep(ctx, sleepFor); err != nil {
				return 0, limit, err
			}
		}

		if backoff < truncateMaxRetryBackoff {
			backoff *= 2
			if backoff > truncateMaxRetryBackoff {
				backoff = truncateMaxRetryBackoff
			}
		}
	}
}

func (s *Service) sleep(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	if s.sleepFn == nil {
		return sleepWithContext(ctx, d)
	}
	return s.sleepFn(ctx, d)
}

func sleepWithContext(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer func() {
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
	}()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *Service) writeAndFinalize(ctx context.Context, tenantID string, rows []claimedRow) error {
	if len(rows) == 0 {
		return nil
	}

	ids := make([]uint64, 0, len(rows))
	generations := make([]*sigilv1.Generation, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
		generations = append(generations, row.Gen)
	}

	built, err := BuildBlock(tenantID, generations)
	if err != nil {
		return fmt.Errorf("build compaction block: %w", err)
	}
	if err := s.blockWriter.WriteBlock(ctx, tenantID, built.Block); err != nil {
		return fmt.Errorf("write compaction block: %w", err)
	}
	if err := s.metadataStore.InsertBlock(ctx, built.Meta); err != nil {
		if !errors.Is(err, storage.ErrBlockAlreadyExists) {
			return fmt.Errorf("insert block metadata: %w", err)
		}
		_ = level.Info(s.logger).Log(
			"msg", "compactor idempotency guard reused existing block metadata",
			"phase", compactPhase,
			"tenant_id", tenantID,
			"owner_id", s.ownerID,
			"block_id", built.Block.ID,
		)
	}
	if err := s.claimer.FinalizeClaimed(ctx, tenantID, s.ownerID, ids); err != nil {
		return fmt.Errorf("finalize claimed rows: %w", err)
	}

	observeCompacted(len(generations))
	observeCompactionBatchRows(len(generations))
	observeCompactionBlockSizeBytes(built.Meta.SizeBytes)
	_ = level.Info(s.logger).Log(
		"msg", "compactor block created",
		"phase", compactPhase,
		"tenant_id", tenantID,
		"owner_id", s.ownerID,
		"block_id", built.Block.ID,
		"compacted", len(generations),
		"size_bytes", built.Meta.SizeBytes,
	)
	return nil
}

func (s *Service) shardPredicate(shardID int) storage.ShardPredicate {
	return storage.ShardPredicate{
		ShardWindowSeconds: s.cfg.ShardWindowSeconds,
		ShardCount:         s.cfg.ShardCount,
		ShardID:            shardID,
	}
}

func (s *Service) discoveryLimit() int {
	limit := s.cfg.Workers * 4
	if limit <= 0 {
		return 8
	}
	return limit
}

type claimedRow struct {
	ID   uint64
	Gen  *sigilv1.Generation
	Size int64
}

// splitRowsByTarget returns a prefix slice whose payload bytes are at least targetBytes
// (or all rows if targetBytes is non-positive or the batch is smaller).
func splitRowsByTarget(rows []claimedRow, targetBytes int64) ([]claimedRow, []claimedRow) {
	if len(rows) == 0 {
		return nil, nil
	}
	if targetBytes <= 0 {
		return rows, nil
	}

	total := int64(0)
	cut := 0
	for i, row := range rows {
		total += row.Size
		cut = i + 1
		if total >= targetBytes {
			break
		}
	}
	if cut <= 0 {
		cut = 1
	}
	if cut >= len(rows) {
		return rows, nil
	}
	return rows[:cut], rows[cut:]
}

func defaultOwnerID() string {
	hostname, err := os.Hostname()
	if err != nil || strings.TrimSpace(hostname) == "" {
		hostname = "unknown-host"
	}

	var suffix [4]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return hostname
	}
	return fmt.Sprintf("%s-%s", hostname, hex.EncodeToString(suffix[:]))
}
