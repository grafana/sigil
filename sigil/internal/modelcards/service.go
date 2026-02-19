package modelcards

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

const refreshLeaseScopeKey = "model-cards-refresh"

type Service struct {
	store        Store
	source       Source
	snapshot     *Snapshot
	supplemental *SupplementalCatalog
	cfg          Config
	logger       *slog.Logger
	now          func() time.Time
}

func NewService(store Store, source Source, snapshot *Snapshot, cfg Config, logger *slog.Logger) *Service {
	return NewServiceWithSupplemental(store, source, snapshot, nil, cfg, logger)
}

func NewServiceWithSupplemental(
	store Store,
	source Source,
	snapshot *Snapshot,
	supplemental *SupplementalCatalog,
	cfg Config,
	logger *slog.Logger,
) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	if cfg.SyncInterval <= 0 {
		cfg.SyncInterval = 30 * time.Minute
	}
	if cfg.LeaseTTL <= 0 {
		cfg.LeaseTTL = 2 * time.Minute
	}
	if cfg.SourceTimeout <= 0 {
		cfg.SourceTimeout = 15 * time.Second
	}
	if cfg.StaleSoft <= 0 {
		cfg.StaleSoft = 2 * time.Hour
	}
	if cfg.StaleHard <= 0 {
		cfg.StaleHard = 24 * time.Hour
	}
	if cfg.BootstrapMode == "" {
		cfg.BootstrapMode = BootstrapModeSnapshotFirst
	}
	if cfg.OwnerID == "" {
		cfg.OwnerID = defaultOwnerID()
	}

	return &Service{
		store:        store,
		source:       source,
		snapshot:     snapshot,
		supplemental: supplemental,
		cfg:          cfg,
		logger:       logger,
		now: func() time.Time {
			return time.Now().UTC()
		},
	}
}

func (s *Service) RunSyncLoop(ctx context.Context) error {
	if s.store == nil {
		return nil
	}
	s.logger.Info("model-cards sync loop started", "source", s.source.Name(), "interval", s.cfg.SyncInterval.String())
	_, _ = s.syncOnce(ctx, "primary", false)

	ticker := time.NewTicker(s.cfg.SyncInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			_, _ = s.syncOnce(ctx, "primary", false)
		}
	}
}

func (s *Service) RefreshNow(ctx context.Context, mode string) (RefreshRun, error) {
	if strings.TrimSpace(mode) == "" {
		mode = "primary"
	}
	return s.syncOnce(ctx, mode, true)
}

func (s *Service) syncOnce(ctx context.Context, mode string, force bool) (RefreshRun, error) {
	run := RefreshRun{
		Source:    s.source.Name(),
		RunMode:   mode,
		Status:    "failed",
		StartedAt: s.now(),
	}
	s.logger.Info("model-cards refresh started", "source", run.Source, "mode", mode, "force", force)

	now := s.now()
	acquired, err := s.store.TryAcquireLease(ctx, refreshLeaseScopeKey, s.cfg.OwnerID, now, s.cfg.LeaseTTL)
	if err != nil {
		run.ErrorSummary = err.Error()
		run.FinishedAt = s.now()
		_ = s.store.RecordRefreshRun(ctx, run)
		observeRefreshMetrics(run)
		s.logger.Error("model-cards refresh failed to acquire lease", "source", run.Source, "mode", mode, "err", err)
		return run, err
	}
	if !acquired {
		run.Status = "skipped"
		run.ErrorSummary = "lease not acquired"
		run.FinishedAt = s.now()
		_ = s.store.RecordRefreshRun(ctx, run)
		observeRefreshMetrics(run)
		s.logger.Debug("model-cards refresh skipped", "source", run.Source, "mode", mode, "reason", run.ErrorSummary)
		if force {
			return run, nil
		}
		return run, nil
	}
	defer func() {
		_ = s.store.ReleaseLease(context.Background(), refreshLeaseScopeKey, s.cfg.OwnerID)
	}()

	fetchCtx, cancel := context.WithTimeout(ctx, s.cfg.SourceTimeout)
	cards, fetchErr := s.source.Fetch(fetchCtx)
	cancel()

	_, _ = s.store.RenewLease(ctx, refreshLeaseScopeKey, s.cfg.OwnerID, s.now(), s.cfg.LeaseTTL)
	refreshedAt := s.now()

	if fetchErr != nil {
		if s.snapshot == nil {
			run.ErrorSummary = fetchErr.Error()
			run.FinishedAt = s.now()
			_ = s.store.RecordRefreshRun(ctx, run)
			observeRefreshMetrics(run)
			s.logger.Error("model-cards refresh failed without fallback", "source", run.Source, "mode", mode, "err", fetchErr)
			return run, fetchErr
		}
		run.RunMode = "fallback"
		run.Status = "partial"
		run.ErrorSummary = fetchErr.Error()
		s.logger.Warn("model-cards refresh using snapshot fallback", "source", run.Source, "mode", mode, "err", fetchErr)
		cards, err = s.snapshotCards(refreshedAt)
		if err != nil {
			run.Status = "failed"
			run.ErrorSummary = err.Error()
			run.FinishedAt = s.now()
			_ = s.store.RecordRefreshRun(ctx, run)
			observeRefreshMetrics(run)
			s.logger.Error("model-cards refresh failed to build fallback snapshot catalog", "source", run.Source, "mode", mode, "err", err)
			return run, err
		}
	} else {
		cards, err = s.mergeSupplementalCards(cards, refreshedAt)
		if err != nil {
			run.Status = "failed"
			run.ErrorSummary = err.Error()
			run.FinishedAt = s.now()
			_ = s.store.RecordRefreshRun(ctx, run)
			observeRefreshMetrics(run)
			s.logger.Error("model-cards refresh failed to merge supplemental catalog", "source", run.Source, "mode", mode, "err", err)
			return run, err
		}
		run.Status = "success"
		s.logger.Debug("model-cards primary source fetch succeeded", "source", run.Source, "mode", mode, "fetched_count", len(cards))
	}

	run.FetchedCount = len(cards)
	upserted, err := s.store.UpsertCards(ctx, s.source.Name(), refreshedAt, cards)
	if err != nil {
		run.Status = "failed"
		run.ErrorSummary = err.Error()
		run.FinishedAt = s.now()
		_ = s.store.RecordRefreshRun(ctx, run)
		observeRefreshMetrics(run)
		s.logger.Error("model-cards refresh failed to upsert", "source", run.Source, "mode", run.RunMode, "fetched_count", run.FetchedCount, "err", err)
		return run, err
	}
	if run.Status == "partial" && upserted == 0 {
		run.Status = "failed"
	}
	run.UpsertedCount = upserted
	run.FinishedAt = s.now()
	if err := s.store.RecordRefreshRun(ctx, run); err != nil {
		s.logger.Warn("record refresh run failed", "err", err)
	}
	observeRefreshMetrics(run)
	s.observeCatalogState(ctx)
	s.logger.Info(
		"model-cards refresh completed",
		"source",
		run.Source,
		"mode",
		run.RunMode,
		"status",
		run.Status,
		"fetched_count",
		run.FetchedCount,
		"upserted_count",
		run.UpsertedCount,
	)
	return run, nil
}

func (s *Service) List(ctx context.Context, params ListParams) (ListResult, error) {
	if params.Limit <= 0 {
		params.Limit = 50
	}

	path, freshness, err := s.readPath(ctx)
	if err != nil {
		return ListResult{}, err
	}

	if path == SourcePathSnapshotFallback {
		cards, err := s.snapshotCards(s.now())
		if err != nil {
			return ListResult{}, err
		}
		filtered := filterSnapshotCards(cards, params)
		hasMore := false
		nextOffset := params.Offset + len(filtered)
		if len(filtered) > params.Limit {
			hasMore = true
			filtered = filtered[:params.Limit]
			nextOffset = params.Offset + len(filtered)
		}
		freshness.SourcePath = path
		observeReadPath("list", path)
		s.observeCatalogState(ctx)
		return ListResult{Data: filtered, HasMore: hasMore, NextOffset: nextOffset, Freshness: freshness}, nil
	}

	cards, hasMore, err := s.store.ListCards(ctx, params)
	if err != nil {
		return ListResult{}, err
	}
	freshness.SourcePath = path
	observeReadPath("list", path)
	s.observeCatalogState(ctx)
	return ListResult{Data: cards, HasMore: hasMore, NextOffset: params.Offset + len(cards), Freshness: freshness}, nil
}

func (s *Service) Lookup(ctx context.Context, modelKey string, source string, sourceModelID string) (*Card, Freshness, error) {
	path, freshness, err := s.readPath(ctx)
	if err != nil {
		return nil, Freshness{}, err
	}
	freshness.SourcePath = path
	observeReadPath("lookup", path)
	s.observeCatalogState(ctx)

	if path == SourcePathSnapshotFallback {
		cards, err := s.snapshotCards(s.now())
		if err != nil {
			return nil, freshness, err
		}
		for _, card := range cards {
			if modelKey != "" && card.ModelKey == modelKey {
				return &card, freshness, nil
			}
			if source != "" && sourceModelID != "" && card.Source == source && card.SourceModelID == sourceModelID {
				return &card, freshness, nil
			}
		}
		return nil, freshness, ErrNotFound
	}

	if modelKey != "" {
		card, err := s.store.GetCardByModelKey(ctx, modelKey)
		if err != nil {
			return nil, freshness, err
		}
		return card, freshness, nil
	}

	card, err := s.store.GetCardBySourceID(ctx, source, sourceModelID)
	if err != nil {
		return nil, freshness, err
	}
	return card, freshness, nil
}

func (s *Service) SourceStatuses(ctx context.Context) ([]SourceStatus, error) {
	latestRefresh, err := s.store.LatestRefreshedAt(ctx)
	if err != nil {
		return nil, err
	}
	count, err := s.store.CountCards(ctx)
	if err == nil {
		setCatalogState(s.source.Name(), count, latestRefresh, s.now())
	}
	status := SourceStatus{
		Source: s.source.Name(),
	}
	if latestRefresh != nil {
		stale := s.now().Sub(*latestRefresh) > s.cfg.StaleSoft
		status.LastSuccessAt = latestRefresh
		status.Stale = stale
	}
	run, err := s.store.LatestRefreshRun(ctx, s.source.Name())
	if err == nil {
		status.LastRunStatus = run.Status
		status.LastRunMode = run.RunMode
	}
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	return []SourceStatus{status}, nil
}

func (s *Service) readPath(ctx context.Context) (string, Freshness, error) {
	count, err := s.store.CountCards(ctx)
	if err != nil {
		return "", Freshness{}, err
	}
	if count == 0 && s.cfg.BootstrapMode == BootstrapModeSnapshotFirst && s.snapshot != nil {
		path := SourcePathSnapshotFallback
		freshness := Freshness{Stale: true, SoftStale: true, HardStale: true}
		s.logger.Debug("model-cards read path selected", "source_path", path, "reason", "empty-catalog", "count", count)
		return path, freshness, nil
	}

	latest, err := s.store.LatestRefreshedAt(ctx)
	if err != nil {
		return "", Freshness{}, err
	}
	if latest == nil {
		if s.cfg.BootstrapMode == BootstrapModeSnapshotFirst && s.snapshot != nil {
			path := SourcePathSnapshotFallback
			freshness := Freshness{Stale: true, SoftStale: true, HardStale: true}
			s.logger.Debug("model-cards read path selected", "source_path", path, "reason", "missing-last-refresh", "count", count)
			return path, freshness, nil
		}
		path := SourcePathMemoryStale
		freshness := Freshness{Stale: true, SoftStale: true, HardStale: true}
		return path, freshness, nil
	}

	age := s.now().Sub(*latest)
	freshness := Freshness{
		CatalogLastRefreshedAt: latest,
		Stale:                  age > s.cfg.StaleSoft,
		SoftStale:              age > s.cfg.StaleSoft,
		HardStale:              age > s.cfg.StaleHard,
	}

	if freshness.HardStale && s.cfg.BootstrapMode == BootstrapModeSnapshotFirst && s.snapshot != nil {
		path := SourcePathSnapshotFallback
		s.logger.Debug("model-cards read path selected", "source_path", path, "reason", "hard-stale-catalog", "age", age.String())
		return path, freshness, nil
	}
	if freshness.Stale {
		return SourcePathMemoryStale, freshness, nil
	}
	return SourcePathMemoryLive, freshness, nil
}

func (s *Service) observeCatalogState(ctx context.Context) {
	if s.store == nil {
		return
	}
	count, err := s.store.CountCards(ctx)
	if err != nil {
		return
	}
	latest, err := s.store.LatestRefreshedAt(ctx)
	if err != nil {
		return
	}
	setCatalogState(s.source.Name(), count, latest, s.now())
}

func EncodeCursor(offset int) string {
	if offset <= 0 {
		return ""
	}
	return base64.StdEncoding.EncodeToString([]byte(strconv.Itoa(offset)))
}

func DecodeCursor(cursor string) (int, error) {
	cursor = strings.TrimSpace(cursor)
	if cursor == "" {
		return 0, nil
	}
	raw, err := base64.StdEncoding.DecodeString(cursor)
	if err != nil {
		return 0, fmt.Errorf("invalid cursor")
	}
	offset, err := strconv.Atoi(string(raw))
	if err != nil || offset < 0 {
		return 0, fmt.Errorf("invalid cursor")
	}
	return offset, nil
}

func filterSnapshotCards(cards []Card, params ListParams) []Card {
	filtered := make([]Card, 0, len(cards))
	for _, card := range cards {
		if !matchesFilter(card, params) {
			continue
		}
		filtered = append(filtered, card)
	}
	sortCards(filtered, params.Sort, params.Order)
	if params.Offset >= len(filtered) {
		return []Card{}
	}
	if params.Limit <= 0 {
		params.Limit = 50
	}
	end := params.Offset + params.Limit + 1
	if end > len(filtered) {
		end = len(filtered)
	}
	return filtered[params.Offset:end]
}

func (s *Service) snapshotCards(refreshedAt time.Time) ([]Card, error) {
	if s.snapshot == nil {
		return nil, errors.New("snapshot model-card fallback is not configured")
	}
	return s.mergeSupplementalCards(CardsFromSnapshot(*s.snapshot, refreshedAt), refreshedAt)
}

func (s *Service) mergeSupplementalCards(cards []Card, refreshedAt time.Time) ([]Card, error) {
	return MergeSupplementalCards(cards, refreshedAt, s.supplemental)
}

func defaultOwnerID() string {
	hostname, err := os.Hostname()
	if err != nil || strings.TrimSpace(hostname) == "" {
		hostname = "sigil"
	}
	random := make([]byte, 4)
	if _, err := rand.Read(random); err != nil {
		return hostname
	}
	return fmt.Sprintf("%s-%x", hostname, random)
}
