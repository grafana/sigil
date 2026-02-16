package sigil

import (
	"context"
	"strings"
	"testing"

	"github.com/grafana/sigil/sigil/internal/config"
	generationingest "github.com/grafana/sigil/sigil/internal/ingest/generation"
)

func TestServerModuleBuildGenerationStoreRejectsMemoryBackend(t *testing.T) {
	module := serverModule{
		cfg: config.Config{
			Target:         config.TargetServer,
			StorageBackend: "memory",
		},
	}

	_, err := module.buildGenerationStore(context.Background())
	if err == nil {
		t.Fatalf("expected unsupported backend error")
	}
	if !strings.Contains(err.Error(), "unsupported storage backend") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestServerModuleBuildFeedbackStoreRejectsNonFeedbackStore(t *testing.T) {
	module := serverModule{
		cfg: config.Config{StorageBackend: "mysql"},
	}

	_, err := module.buildFeedbackStore(generationingest.NewMemoryStore())
	if err == nil {
		t.Fatalf("expected feedback store compatibility error")
	}
	if !strings.Contains(err.Error(), "does not support feedback storage") {
		t.Fatalf("unexpected error: %v", err)
	}
}
