package predefined

import (
	"context"
	"strings"
	"sync"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

type Seeder struct {
	store seedStore
	seen  sync.Map
}

type seedStore interface {
	CreateEvaluator(ctx context.Context, evaluator evalpkg.EvaluatorDefinition) error
}

func NewSeeder(store seedStore) *Seeder {
	return &Seeder{store: store}
}

func (s *Seeder) EnsureTenantSeeded(ctx context.Context, tenantID string) error {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" || s == nil || s.store == nil {
		return nil
	}
	if _, ok := s.seen.Load(trimmedTenantID); ok {
		return nil
	}

	for _, template := range Templates() {
		item := template.EvaluatorDefinition
		item.TenantID = trimmedTenantID
		item.IsPredefined = true
		if err := s.store.CreateEvaluator(ctx, item); err != nil {
			return err
		}
	}

	s.seen.Store(trimmedTenantID, struct{}{})
	return nil
}
