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

func TestResolveBatch(t *testing.T) {
	now := time.Now().UTC()
	store := NewMemoryStore()
	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	_, err := store.UpsertCards(context.Background(), SourceOpenRouter, now, []Card{
		{
			ModelKey:      "openrouter:openai/gpt-4o",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-4o",
			CanonicalSlug: "openai/gpt-4o",
			Name:          "GPT-4o",
			Provider:      "openai",
			Pricing: Pricing{
				PromptUSDPerToken:     floatPtr(0.001),
				CompletionUSDPerToken: floatPtr(0.002),
			},
		},
		{
			ModelKey:      "openrouter:anthropic/claude-sonnet-4.5",
			Source:        SourceOpenRouter,
			SourceModelID: "anthropic/claude-sonnet-4.5",
			CanonicalSlug: "anthropic/claude-4.5-sonnet-20250929",
			Name:          "Claude Sonnet 4.5",
			Provider:      "anthropic",
			Pricing: Pricing{
				PromptUSDPerToken:     floatPtr(0.003),
				CompletionUSDPerToken: floatPtr(0.015),
			},
		},
		{
			ModelKey:      "openrouter:openai/test.foo",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/test.foo",
			Name:          "test.foo",
			Provider:      "openai",
		},
		{
			ModelKey:      "openrouter:openai/test-foo",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/test-foo",
			Name:          "test-foo",
			Provider:      "openai",
		},
		{
			ModelKey:      "openrouter:google/gemini-2.5-pro",
			Source:        SourceOpenRouter,
			SourceModelID: "google/gemini-2.5-pro",
			Name:          "Gemini 2.5 Pro",
			Provider:      "google",
		},
		{
			ModelKey:      "openrouter:amazon/nova-pro-v1",
			Source:        SourceOpenRouter,
			SourceModelID: "amazon/nova-pro-v1",
			Name:          "Nova Pro v1",
			Provider:      "amazon",
		},
		{
			ModelKey:      "openrouter:meta-llama/llama-3.3-70b-instruct",
			Source:        SourceOpenRouter,
			SourceModelID: "meta-llama/llama-3.3-70b-instruct",
			Name:          "Llama 3.3 70B Instruct",
			Provider:      "meta-llama",
		},
		{
			ModelKey:      "openrouter:meta-llama/llama-4-maverick",
			Source:        SourceOpenRouter,
			SourceModelID: "meta-llama/llama-4-maverick",
			Name:          "Llama 4 Maverick",
			Provider:      "meta-llama",
		},
		{
			ModelKey:      "openrouter:openai/gpt-4.1",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-4.1",
			CanonicalSlug: "openai/gpt-4.1-2025-04-14",
			Name:          "GPT-4.1",
			Provider:      "openai",
		},
		{
			ModelKey:      "openrouter:openai/gpt-5-chat",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-5-chat",
			CanonicalSlug: "openai/gpt-5-chat-2025-08-07",
			Name:          "GPT-5 Chat",
			Provider:      "openai",
		},
		{
			ModelKey:      "openrouter:openai/gpt-3.5-turbo",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-3.5-turbo",
			Name:          "GPT-3.5 Turbo",
			Provider:      "openai",
		},
		{
			ModelKey:      "openrouter:openai/gpt-3.5-turbo-16k",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-3.5-turbo-16k",
			Name:          "GPT-3.5 Turbo 16k",
			Provider:      "openai",
		},
		{
			ModelKey:      "openrouter:openai/gpt-4",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-4",
			Name:          "GPT-4",
			Provider:      "openai",
		},
		{
			ModelKey:      "openrouter:openai/gpt-4-turbo",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-4-turbo",
			Name:          "GPT-4 Turbo",
			Provider:      "openai",
		},
		{
			ModelKey:      "openrouter:openai/gpt-4-turbo-preview",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-4-turbo-preview",
			Name:          "GPT-4 Turbo Preview",
			Provider:      "openai",
		},
		{
			ModelKey:      "openrouter:openai/gpt-4o-audio-preview",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-4o-audio-preview",
			Name:          "GPT-4o Audio Preview",
			Provider:      "openai",
		},
		{
			ModelKey:      "openrouter:openai/gpt-5.1",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-5.1",
			Name:          "GPT-5.1",
			Provider:      "openai",
		},
		{
			ModelKey:      "openrouter:openai/gpt-5.2",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-5.2",
			Name:          "GPT-5.2",
			Provider:      "openai",
		},
		{
			ModelKey:      "openrouter:openai/gpt-5.2-pro",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/gpt-5.2-pro",
			Name:          "GPT-5.2 Pro",
			Provider:      "openai",
		},
		{
			ModelKey:      "openrouter:openai/o1-pro",
			Source:        SourceOpenRouter,
			SourceModelID: "openai/o1-pro",
			Name:          "o1 Pro",
			Provider:      "openai",
		},
		{
			ModelKey:      "openrouter:anthropic/claude-3.7-sonnet",
			Source:        SourceOpenRouter,
			SourceModelID: "anthropic/claude-3.7-sonnet",
			CanonicalSlug: "anthropic/claude-3-7-sonnet-20250219",
			Name:          "Claude 3.7 Sonnet",
			Provider:      "anthropic",
		},
		{
			ModelKey:      "openrouter:anthropic/claude-opus-4.1",
			Source:        SourceOpenRouter,
			SourceModelID: "anthropic/claude-opus-4.1",
			CanonicalSlug: "anthropic/claude-4.1-opus-20250805",
			Name:          "Claude Opus 4.1",
			Provider:      "anthropic",
		},
		{
			ModelKey:      "openrouter:anthropic/claude-opus-4",
			Source:        SourceOpenRouter,
			SourceModelID: "anthropic/claude-opus-4",
			Name:          "Claude Opus 4",
			Provider:      "anthropic",
		},
		{
			ModelKey:      "openrouter:anthropic/claude-opus-4.6",
			Source:        SourceOpenRouter,
			SourceModelID: "anthropic/claude-opus-4.6",
			Name:          "Claude Opus 4.6",
			Provider:      "anthropic",
		},
		{
			ModelKey:      "openrouter:anthropic/claude-sonnet-4",
			Source:        SourceOpenRouter,
			SourceModelID: "anthropic/claude-sonnet-4",
			Name:          "Claude Sonnet 4",
			Provider:      "anthropic",
		},
		{
			ModelKey:      "openrouter:anthropic/claude-sonnet-4-5-20250929",
			Source:        SourceOpenRouter,
			SourceModelID: "anthropic/claude-sonnet-4-5-20250929",
			Name:          "Claude Sonnet 4.5 (2025-09-29)",
			Provider:      "anthropic",
		},
		{
			ModelKey:      "openrouter:cohere/command-r-08-2024",
			Source:        SourceOpenRouter,
			SourceModelID: "cohere/command-r-08-2024",
			Name:          "Command R (08-2024)",
			Provider:      "cohere",
		},
		{
			ModelKey:      "openrouter:cohere/command-r-plus-08-2024",
			Source:        SourceOpenRouter,
			SourceModelID: "cohere/command-r-plus-08-2024",
			Name:          "Command R+ (08-2024)",
			Provider:      "cohere",
		},
		{
			ModelKey:      "openrouter:mistralai/ministral-8b-2512",
			Source:        SourceOpenRouter,
			SourceModelID: "mistralai/ministral-8b-2512",
			Name:          "Ministral 8B",
			Provider:      "mistralai",
		},
		{
			ModelKey:      "openrouter:x-ai/grok-4",
			Source:        SourceOpenRouter,
			SourceModelID: "x-ai/grok-4",
			Name:          "Grok 4",
			Provider:      "x-ai",
		},
	})
	if err != nil {
		t.Fatalf("seed cards: %v", err)
	}

	svc := NewService(store, NewStaticErrorSource(errors.New("disabled")), nil, Config{
		SyncInterval:  30 * time.Minute,
		LeaseTTL:      2 * time.Minute,
		SourceTimeout: 2 * time.Second,
		StaleSoft:     2 * time.Hour,
		StaleHard:     24 * time.Hour,
		BootstrapMode: BootstrapModeDBOnly,
		OwnerID:       "owner-a",
	}, nil)

	tests := []struct {
		name               string
		input              ResolveInput
		expectedStatus     string
		expectedReason     string
		expectedStrategy   string
		expectedModelKey   string
		expectedSourceID   string
		expectedSourcePath string
	}{
		{
			name:               "exact provider and model part",
			input:              ResolveInput{Provider: "openai", Model: "gpt-4o"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:openai/gpt-4o",
			expectedSourceID:   "openai/gpt-4o",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "normalized provider and model",
			input:              ResolveInput{Provider: "anthropic", Model: "claude-sonnet-4-5"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:anthropic/claude-sonnet-4.5",
			expectedSourceID:   "anthropic/claude-sonnet-4.5",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "openai canonical date alias resolves",
			input:              ResolveInput{Provider: "openai", Model: "gpt-4.1-2025-04-14"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:openai/gpt-4.1",
			expectedSourceID:   "openai/gpt-4.1",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "openai latest alias resolves",
			input:              ResolveInput{Provider: "openai", Model: "gpt-5-chat-latest"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:openai/gpt-5-chat",
			expectedSourceID:   "openai/gpt-5-chat",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "openai sdk dated gpt-3.5 alias resolves",
			input:              ResolveInput{Provider: "openai", Model: "gpt-3.5-turbo-0125"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:openai/gpt-3.5-turbo",
			expectedSourceID:   "openai/gpt-3.5-turbo",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "openai sdk dated gpt-3.5-16k alias resolves",
			input:              ResolveInput{Provider: "openai", Model: "gpt-3.5-turbo-16k-0613"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:openai/gpt-3.5-turbo-16k",
			expectedSourceID:   "openai/gpt-3.5-turbo-16k",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "openai sdk dated gpt-4 alias resolves",
			input:              ResolveInput{Provider: "openai", Model: "gpt-4-0613"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:openai/gpt-4",
			expectedSourceID:   "openai/gpt-4",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "openai sdk gpt-4 preview alias resolves",
			input:              ResolveInput{Provider: "openai", Model: "gpt-4-0125-preview"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:openai/gpt-4-turbo-preview",
			expectedSourceID:   "openai/gpt-4-turbo-preview",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "openai sdk dated gpt-4-turbo alias resolves",
			input:              ResolveInput{Provider: "openai", Model: "gpt-4-turbo-2024-04-09"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:openai/gpt-4-turbo",
			expectedSourceID:   "openai/gpt-4-turbo",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "openai sdk dated gpt-4o audio alias resolves",
			input:              ResolveInput{Provider: "openai", Model: "gpt-4o-audio-preview-2024-12-17"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:openai/gpt-4o-audio-preview",
			expectedSourceID:   "openai/gpt-4o-audio-preview",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "openai sdk dated gpt-5.2 alias resolves",
			input:              ResolveInput{Provider: "openai", Model: "gpt-5.2-2025-12-11"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:openai/gpt-5.2",
			expectedSourceID:   "openai/gpt-5.2",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "openai sdk dated o1-pro alias resolves",
			input:              ResolveInput{Provider: "openai", Model: "o1-pro-2025-03-19"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:openai/o1-pro",
			expectedSourceID:   "openai/o1-pro",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "azure provider alias resolves openai model",
			input:              ResolveInput{Provider: "azure-openai", Model: "gpt-4.1-2025-04-14"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:openai/gpt-4.1",
			expectedSourceID:   "openai/gpt-4.1",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "provider mismatch is unresolved",
			input:              ResolveInput{Provider: "openai", Model: "claude-sonnet-4-5"},
			expectedStatus:     ResolveStatusUnresolved,
			expectedReason:     ResolveReasonNotFound,
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "gemini provider alias resolves to google catalog",
			input:              ResolveInput{Provider: "gemini", Model: "gemini-2.5-pro"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:google/gemini-2.5-pro",
			expectedSourceID:   "google/gemini-2.5-pro",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "google-vertex provider alias resolves",
			input:              ResolveInput{Provider: "google-vertex", Model: "gemini-2.5-pro"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:google/gemini-2.5-pro",
			expectedSourceID:   "google/gemini-2.5-pro",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "vertex-ai provider alias resolves",
			input:              ResolveInput{Provider: "vertex-ai", Model: "gemini-2.5-pro"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:google/gemini-2.5-pro",
			expectedSourceID:   "google/gemini-2.5-pro",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "vertex models prefix resolves",
			input:              ResolveInput{Provider: "gemini", Model: "models/gemini-2.5-pro"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:google/gemini-2.5-pro",
			expectedSourceID:   "google/gemini-2.5-pro",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "vertex publisher path resolves",
			input:              ResolveInput{Provider: "vertex", Model: "projects/test-project/locations/us-central1/publishers/google/models/gemini-2.5-pro"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:google/gemini-2.5-pro",
			expectedSourceID:   "google/gemini-2.5-pro",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "anthropic latest variant resolves",
			input:              ResolveInput{Provider: "anthropic", Model: "claude-3-7-sonnet-latest"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:anthropic/claude-3.7-sonnet",
			expectedSourceID:   "anthropic/claude-3.7-sonnet",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "anthropic dated sdk variant resolves",
			input:              ResolveInput{Provider: "anthropic", Model: "claude-opus-4-1-20250805"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:anthropic/claude-opus-4.1",
			expectedSourceID:   "anthropic/claude-opus-4.1",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "anthropic canonical order variant resolves",
			input:              ResolveInput{Provider: "anthropic", Model: "claude-4-5-sonnet-20250929"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:anthropic/claude-sonnet-4.5",
			expectedSourceID:   "anthropic/claude-sonnet-4.5",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "anthropic mapped sdk alias resolves",
			input:              ResolveInput{Provider: "anthropic", Model: "claude-opus-4-6-v1"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:anthropic/claude-opus-4.6",
			expectedSourceID:   "anthropic/claude-opus-4.6",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "anthropic sdk 4-0 alias resolves",
			input:              ResolveInput{Provider: "anthropic", Model: "claude-opus-4-0"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:anthropic/claude-opus-4",
			expectedSourceID:   "anthropic/claude-opus-4",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "vertex anthropic sdk 4-0 alias resolves",
			input:              ResolveInput{Provider: "vertex", Model: "claude-sonnet-4-0"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:anthropic/claude-sonnet-4",
			expectedSourceID:   "anthropic/claude-sonnet-4",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "bedrock dotted model resolves",
			input:              ResolveInput{Provider: "bedrock", Model: "anthropic.claude-sonnet-4-5-20250929-v1:0"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:anthropic/claude-sonnet-4-5-20250929",
			expectedSourceID:   "anthropic/claude-sonnet-4-5-20250929",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "bedrock amazon model resolves",
			input:              ResolveInput{Provider: "bedrock", Model: "amazon.nova-pro-v1:0"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:amazon/nova-pro-v1",
			expectedSourceID:   "amazon/nova-pro-v1",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "bedrock cohere command-r mapped alias resolves",
			input:              ResolveInput{Provider: "bedrock", Model: "cohere.command-r-v1:0"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:cohere/command-r-08-2024",
			expectedSourceID:   "cohere/command-r-08-2024",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "bedrock cohere command-r-plus mapped alias resolves",
			input:              ResolveInput{Provider: "bedrock", Model: "cohere.command-r-plus-v1:0"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:cohere/command-r-plus-08-2024",
			expectedSourceID:   "cohere/command-r-plus-08-2024",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "bedrock mistral ministral mapped alias resolves",
			input:              ResolveInput{Provider: "bedrock", Model: "mistral.ministral-3-8b-instruct"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:mistralai/ministral-8b-2512",
			expectedSourceID:   "mistralai/ministral-8b-2512",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "bedrock meta model resolves",
			input:              ResolveInput{Provider: "bedrock", Model: "meta.llama3-3-70b-instruct-v1:0"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyNormalized,
			expectedModelKey:   "openrouter:meta-llama/llama-3.3-70b-instruct",
			expectedSourceID:   "meta-llama/llama-3.3-70b-instruct",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "bedrock llama4 meta model resolves",
			input:              ResolveInput{Provider: "bedrock", Model: "meta.llama4-maverick-17b-instruct-v1:0"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:meta-llama/llama-4-maverick",
			expectedSourceID:   "meta-llama/llama-4-maverick",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "bedrock arn foundation model resolves",
			input:              ResolveInput{Provider: "aws-bedrock", Model: "arn:aws:bedrock:us-east-1:123456789012:foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:anthropic/claude-sonnet-4-5-20250929",
			expectedSourceID:   "anthropic/claude-sonnet-4-5-20250929",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "xai provider alias resolves",
			input:              ResolveInput{Provider: "xai", Model: "grok-4"},
			expectedStatus:     ResolveStatusResolved,
			expectedStrategy:   ResolveMatchStrategyExact,
			expectedModelKey:   "openrouter:x-ai/grok-4",
			expectedSourceID:   "x-ai/grok-4",
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "ambiguous normalized alias",
			input:              ResolveInput{Provider: "openai", Model: "test_foo"},
			expectedStatus:     ResolveStatusUnresolved,
			expectedReason:     ResolveReasonAmbiguous,
			expectedSourcePath: SourcePathMemoryLive,
		},
		{
			name:               "invalid input",
			input:              ResolveInput{Provider: "", Model: "gpt-4o"},
			expectedStatus:     ResolveStatusUnresolved,
			expectedReason:     ResolveReasonInvalidInput,
			expectedSourcePath: SourcePathMemoryLive,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			results, freshness, err := svc.ResolveBatch(context.Background(), []ResolveInput{tc.input})
			if err != nil {
				t.Fatalf("resolve batch: %v", err)
			}
			if len(results) != 1 {
				t.Fatalf("expected one result, got %d", len(results))
			}
			got := results[0]
			if got.Status != tc.expectedStatus {
				t.Fatalf("expected status %q, got %q", tc.expectedStatus, got.Status)
			}
			if got.Reason != tc.expectedReason {
				t.Fatalf("expected reason %q, got %q", tc.expectedReason, got.Reason)
			}
			if got.MatchStrategy != tc.expectedStrategy {
				t.Fatalf("expected match strategy %q, got %q", tc.expectedStrategy, got.MatchStrategy)
			}
			if tc.expectedModelKey != "" {
				if got.Card == nil {
					t.Fatalf("expected resolved card")
				}
				if got.Card.ModelKey != tc.expectedModelKey {
					t.Fatalf("expected model key %q, got %q", tc.expectedModelKey, got.Card.ModelKey)
				}
				if got.Card.SourceModelID != tc.expectedSourceID {
					t.Fatalf("expected source model id %q, got %q", tc.expectedSourceID, got.Card.SourceModelID)
				}
			} else if got.Card != nil {
				t.Fatalf("expected no resolved card for unresolved result")
			}
			if freshness.SourcePath != tc.expectedSourcePath {
				t.Fatalf("expected freshness source path %q, got %q", tc.expectedSourcePath, freshness.SourcePath)
			}
		})
	}
}

func TestResolveBatchMappedAliasRequiresUniqueTarget(t *testing.T) {
	now := time.Now().UTC()
	store := NewMemoryStore()
	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	_, err := store.UpsertCards(context.Background(), SourceOpenRouter, now, []Card{
		{
			ModelKey:      "openrouter:cohere/command-r-08-2024",
			Source:        SourceOpenRouter,
			SourceModelID: "cohere/command-r-08-2024",
			Name:          "Command R (08-2024)",
			Provider:      "cohere",
		},
		{
			ModelKey:      "openrouter:cohere/command-r-08-2024-shadow",
			Source:        SourceOpenRouter,
			SourceModelID: "cohere/command-r-08-2024",
			Name:          "Command R (08-2024) Shadow",
			Provider:      "cohere",
		},
	})
	if err != nil {
		t.Fatalf("seed cards: %v", err)
	}

	svc := NewService(store, NewStaticErrorSource(errors.New("disabled")), nil, Config{
		SyncInterval:  30 * time.Minute,
		LeaseTTL:      2 * time.Minute,
		SourceTimeout: 2 * time.Second,
		StaleSoft:     2 * time.Hour,
		StaleHard:     24 * time.Hour,
		BootstrapMode: BootstrapModeDBOnly,
		OwnerID:       "owner-a",
	}, nil)

	results, freshness, err := svc.ResolveBatch(context.Background(), []ResolveInput{{
		Provider: "bedrock",
		Model:    "cohere.command-r-v1:0",
	}})
	if err != nil {
		t.Fatalf("resolve batch: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected one result, got %d", len(results))
	}
	got := results[0]
	if got.Status != ResolveStatusUnresolved {
		t.Fatalf("expected unresolved status, got %q", got.Status)
	}
	if got.Reason != ResolveReasonNotFound {
		t.Fatalf("expected not_found reason, got %q", got.Reason)
	}
	if got.Card != nil {
		t.Fatalf("expected unresolved card to be nil")
	}
	if freshness.SourcePath != SourcePathMemoryLive {
		t.Fatalf("expected freshness source path %q, got %q", SourcePathMemoryLive, freshness.SourcePath)
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

func floatPtr(value float64) *float64 {
	v := value
	return &v
}
