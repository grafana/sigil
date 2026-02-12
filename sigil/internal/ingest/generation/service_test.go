package generation

import (
	"context"
	"errors"
	"testing"

	"github.com/grafana/dskit/user"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

const testTenantID = "tenant-a"

func TestServiceExportAcceptsValidBatch(t *testing.T) {
	store := NewMemoryStore()
	svc := NewService(store)

	response := svc.Export(tenantContext(), &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-1",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		},
	}})

	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if !response.Results[0].Accepted {
		t.Fatalf("expected accepted result, got error %q", response.Results[0].Error)
	}
	if response.Results[0].GenerationId != "gen-1" {
		t.Fatalf("expected generation id gen-1, got %q", response.Results[0].GenerationId)
	}

	stored, ok := store.Get(testTenantID, "gen-1")
	if !ok {
		t.Fatalf("expected generation in store")
	}
	if stored.Mode != sigilv1.GenerationMode_GENERATION_MODE_SYNC {
		t.Fatalf("expected stored mode sync")
	}
}

func TestServiceExportRejectsInvalidGeneration(t *testing.T) {
	svc := NewService(NewMemoryStore())

	response := svc.Export(tenantContext(), &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-invalid",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			Model: &sigilv1.ModelRef{Name: "gpt-5"},
		},
	}})

	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if response.Results[0].Accepted {
		t.Fatalf("expected rejected result")
	}
	if response.Results[0].Error != "generation.model.provider is required" {
		t.Fatalf("unexpected error: %q", response.Results[0].Error)
	}
}

func TestServiceExportDefaultsModeAndID(t *testing.T) {
	store := NewMemoryStore()
	svc := NewService(store)

	response := svc.Export(tenantContext(), &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Model: &sigilv1.ModelRef{Provider: "anthropic", Name: "claude-sonnet-4-5"},
		},
	}})

	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if !response.Results[0].Accepted {
		t.Fatalf("expected accepted result, got error %q", response.Results[0].Error)
	}
	if response.Results[0].GenerationId == "" {
		t.Fatalf("expected generated id")
	}

	stored, ok := store.Get(testTenantID, response.Results[0].GenerationId)
	if !ok {
		t.Fatalf("expected generation in store")
	}
	if stored.Mode != sigilv1.GenerationMode_GENERATION_MODE_SYNC {
		t.Fatalf("expected default mode sync")
	}
	if stored.OperationName != defaultOperationNameSync {
		t.Fatalf("expected default operation %q, got %q", defaultOperationNameSync, stored.OperationName)
	}
}

func TestServiceExportDefaultsOperationByMode(t *testing.T) {
	store := NewMemoryStore()
	svc := NewService(store)

	response := svc.Export(tenantContext(), &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-stream-default-op",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_STREAM,
			Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		},
	}})

	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if !response.Results[0].Accepted {
		t.Fatalf("expected accepted result, got error %q", response.Results[0].Error)
	}

	stored, ok := store.Get(testTenantID, "gen-stream-default-op")
	if !ok {
		t.Fatalf("expected generation in store")
	}
	if stored.OperationName != defaultOperationNameStream {
		t.Fatalf("expected default operation %q, got %q", defaultOperationNameStream, stored.OperationName)
	}
}

func TestServiceExportReturnsPartialFailures(t *testing.T) {
	svc := NewService(&failingStore{failIndexes: map[int]bool{1: true}})

	response := svc.Export(tenantContext(), &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{Id: "gen-1", Mode: sigilv1.GenerationMode_GENERATION_MODE_SYNC, Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"}},
		{Id: "gen-2", Mode: sigilv1.GenerationMode_GENERATION_MODE_STREAM, Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"}},
	}})

	if len(response.Results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(response.Results))
	}
	if !response.Results[0].Accepted {
		t.Fatalf("expected first generation accepted, got %q", response.Results[0].Error)
	}
	if response.Results[1].Accepted {
		t.Fatalf("expected second generation rejected")
	}
	if response.Results[1].Error != "persist generation" {
		t.Fatalf("unexpected error: %q", response.Results[1].Error)
	}
}

type failingStore struct {
	failIndexes map[int]bool
}

func (s *failingStore) SaveBatch(_ context.Context, _ string, generations []*sigilv1.Generation) []error {
	errs := make([]error, len(generations))
	for i := range generations {
		if s.failIndexes[i] {
			errs[i] = errors.New("persist generation")
		}
	}
	return errs
}

func TestServiceExportRejectsMissingTenant(t *testing.T) {
	svc := NewService(NewMemoryStore())

	response := svc.Export(context.Background(), &sigilv1.ExportGenerationsRequest{Generations: []*sigilv1.Generation{
		{
			Id:    "gen-no-tenant",
			Mode:  sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			Model: &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
		},
	}})

	if len(response.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(response.Results))
	}
	if response.Results[0].Accepted {
		t.Fatalf("expected rejected result")
	}
	if response.Results[0].Error == "" {
		t.Fatalf("expected missing tenant error")
	}
}

func tenantContext() context.Context {
	return user.InjectOrgID(context.Background(), testTenantID)
}
