package anthropic_test

import (
	"errors"
	"testing"

	anthropic "github.com/grafana/sigil/sdks/go-providers/anthropic"
)

func TestConformance_EmbeddingSupportStatus(t *testing.T) {
	err := anthropic.CheckEmbeddingsSupport()
	if err == nil {
		t.Fatalf("expected Anthropic embeddings to remain unsupported")
	}
	if !errors.Is(err, anthropic.ErrEmbeddingsUnsupported) {
		t.Fatalf("expected ErrEmbeddingsUnsupported, got %v", err)
	}
}
