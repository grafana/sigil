package modelcards

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestSyncNowFallsBackToSnapshotWhenSourceFails(t *testing.T) {
	store := NewMemoryStore()
	now := time.Now().UTC()
	snapshot := SnapshotFromCards(SourceOpenRouter, now, []Card{{
		ModelKey:      "openrouter:test/model",
		Source:        SourceOpenRouter,
		SourceModelID: "test/model",
		Name:          "Test Model",
		FirstSeenAt:   now,
		LastSeenAt:    now,
		RefreshedAt:   now,
	}})

	svc := NewService(store, NewStaticErrorSource(errors.New("boom")), &snapshot, Config{
		SyncInterval:  30 * time.Minute,
		LeaseTTL:      2 * time.Minute,
		SourceTimeout: 2 * time.Second,
		StaleSoft:     2 * time.Hour,
		StaleHard:     24 * time.Hour,
		BootstrapMode: BootstrapModeSnapshotFirst,
		OwnerID:       "owner-a",
	}, nil)

	run, err := svc.RefreshNow(context.Background(), "primary")
	if err != nil {
		t.Fatalf("refresh now: %v", err)
	}
	if run.Status != "partial" {
		t.Fatalf("expected partial fallback run, got %q", run.Status)
	}
	if run.RunMode != "fallback" {
		t.Fatalf("expected fallback run mode, got %q", run.RunMode)
	}

	result, err := svc.List(context.Background(), ListParams{Limit: 10})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(result.Data) != 1 {
		t.Fatalf("expected 1 model card, got %d", len(result.Data))
	}
}

func TestSyncNowUsesLeaseForSingletonWriter(t *testing.T) {
	store := NewMemoryStore()
	now := time.Now().UTC()
	snapshot := SnapshotFromCards(SourceOpenRouter, now, []Card{{
		ModelKey:      "openrouter:test/model",
		Source:        SourceOpenRouter,
		SourceModelID: "test/model",
		Name:          "Test Model",
		FirstSeenAt:   now,
		LastSeenAt:    now,
		RefreshedAt:   now,
	}})

	source := &slowSource{cards: []Card{{
		ModelKey:      "openrouter:live/model",
		Source:        SourceOpenRouter,
		SourceModelID: "live/model",
		Name:          "Live Model",
		FirstSeenAt:   now,
		LastSeenAt:    now,
		RefreshedAt:   now,
	}}, delay: 200 * time.Millisecond}

	svcA := NewService(store, source, &snapshot, Config{
		SyncInterval:  30 * time.Minute,
		LeaseTTL:      2 * time.Minute,
		SourceTimeout: 2 * time.Second,
		StaleSoft:     2 * time.Hour,
		StaleHard:     24 * time.Hour,
		BootstrapMode: BootstrapModeSnapshotFirst,
		OwnerID:       "owner-a",
	}, nil)
	svcB := NewService(store, source, &snapshot, Config{
		SyncInterval:  30 * time.Minute,
		LeaseTTL:      2 * time.Minute,
		SourceTimeout: 2 * time.Second,
		StaleSoft:     2 * time.Hour,
		StaleHard:     24 * time.Hour,
		BootstrapMode: BootstrapModeSnapshotFirst,
		OwnerID:       "owner-b",
	}, nil)

	var wg sync.WaitGroup
	wg.Add(2)

	results := make(chan RefreshRun, 2)

	go func() {
		defer wg.Done()
		run, _ := svcA.RefreshNow(context.Background(), "primary")
		results <- run
	}()
	go func() {
		defer wg.Done()
		run, _ := svcB.RefreshNow(context.Background(), "primary")
		results <- run
	}()

	wg.Wait()
	close(results)

	successOrPartial := 0
	skipped := 0
	for run := range results {
		if run.Status == "success" || run.Status == "partial" {
			successOrPartial++
		}
		if run.Status == "skipped" {
			skipped++
		}
	}
	if successOrPartial != 1 {
		t.Fatalf("expected exactly one successful writer, got %d", successOrPartial)
	}
	if skipped != 1 {
		t.Fatalf("expected exactly one skipped writer, got %d", skipped)
	}
}

func TestListUsesSnapshotWhenDBIsHardStale(t *testing.T) {
	store := NewMemoryStore()
	now := time.Now().UTC()

	staleTime := now.Add(-48 * time.Hour)
	_, err := store.UpsertCards(context.Background(), SourceOpenRouter, staleTime, []Card{{
		ModelKey:      "openrouter:stale/model",
		Source:        SourceOpenRouter,
		SourceModelID: "stale/model",
		Name:          "Stale Model",
		FirstSeenAt:   staleTime,
		LastSeenAt:    staleTime,
		RefreshedAt:   staleTime,
	}})
	if err != nil {
		t.Fatalf("seed stale card: %v", err)
	}

	snapshot := SnapshotFromCards(SourceOpenRouter, now, []Card{{
		ModelKey:      "openrouter:snapshot/model",
		Source:        SourceOpenRouter,
		SourceModelID: "snapshot/model",
		Name:          "Snapshot Model",
		FirstSeenAt:   now,
		LastSeenAt:    now,
		RefreshedAt:   now,
	}})

	svc := NewService(store, NewStaticErrorSource(errors.New("boom")), &snapshot, Config{
		SyncInterval:  30 * time.Minute,
		LeaseTTL:      2 * time.Minute,
		SourceTimeout: 2 * time.Second,
		StaleSoft:     2 * time.Hour,
		StaleHard:     24 * time.Hour,
		BootstrapMode: BootstrapModeSnapshotFirst,
		OwnerID:       "owner-a",
	}, nil)

	result, err := svc.List(context.Background(), ListParams{Limit: 10})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if result.Freshness.SourcePath != SourcePathSnapshotFallback {
		t.Fatalf("expected snapshot fallback source path, got %q", result.Freshness.SourcePath)
	}
	if len(result.Data) != 1 || result.Data[0].ModelKey != "openrouter:snapshot/model" {
		t.Fatalf("expected snapshot data, got %#v", result.Data)
	}
}

type slowSource struct {
	cards []Card
	delay time.Duration
}

func (s *slowSource) Name() string {
	return SourceOpenRouter
}

func (s *slowSource) Fetch(ctx context.Context) ([]Card, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(s.delay):
		return s.cards, nil
	}
}
