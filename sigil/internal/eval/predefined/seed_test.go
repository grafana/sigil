package predefined

import (
	"context"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func TestSeederEnsureTenantSeeded(t *testing.T) {
	store := &seedRecorder{}
	seeder := NewSeeder(store)

	if err := seeder.EnsureTenantSeeded(context.Background(), "tenant-a"); err != nil {
		t.Fatalf("seed tenant-a: %v", err)
	}
	if err := seeder.EnsureTenantSeeded(context.Background(), "tenant-a"); err != nil {
		t.Fatalf("re-seed tenant-a: %v", err)
	}
	if len(store.evaluators) != len(Templates()) {
		t.Fatalf("expected exactly %d seeded evaluators for idempotent tenant seed, got %d", len(Templates()), len(store.evaluators))
	}

	if err := seeder.EnsureTenantSeeded(context.Background(), "tenant-b"); err != nil {
		t.Fatalf("seed tenant-b: %v", err)
	}
	if len(store.evaluators) != len(Templates())*2 {
		t.Fatalf("expected %d seeded evaluators for two tenants, got %d", len(Templates())*2, len(store.evaluators))
	}
}

type seedRecorder struct {
	evaluators []evalpkg.EvaluatorDefinition
}

func (s *seedRecorder) CreateEvaluator(_ context.Context, evaluator evalpkg.EvaluatorDefinition) error {
	s.evaluators = append(s.evaluators, evaluator)
	return nil
}
