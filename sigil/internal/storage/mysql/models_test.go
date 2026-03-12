package mysql

import (
	"strings"
	"sync"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"gorm.io/gorm/schema"
)

func TestGenerationScoreModelUsesTextColumnForStringScores(t *testing.T) {
	parsed, err := schema.Parse(&GenerationScoreModel{}, &sync.Map{}, schema.NamingStrategy{})
	if err != nil {
		t.Fatalf("parse schema: %v", err)
	}

	field := parsed.FieldsByName["ScoreString"]
	if field == nil {
		t.Fatal("expected ScoreString field in schema")
	}
	if got := strings.ToLower(field.TagSettings["TYPE"]); got != "text" {
		t.Fatalf("expected ScoreString column type text, got %q (tags=%v)", got, field.TagSettings)
	}
}

func TestScoreToModelKeepsLongStringScores(t *testing.T) {
	longValue := strings.Repeat("severity:critical|", 20)

	model, err := scoreToModel(evalpkg.GenerationScore{
		TenantID:         "tenant-a",
		ScoreID:          "sc-long-1",
		GenerationID:     "gen-long-1",
		EvaluatorID:      "sigil.classifier",
		EvaluatorVersion: "2026-03-12",
		ScoreKey:         "severity",
		ScoreType:        evalpkg.ScoreTypeString,
		Value:            evalpkg.StringValue(longValue),
	})
	if err != nil {
		t.Fatalf("score to model: %v", err)
	}
	if model.ScoreString == nil {
		t.Fatalf("expected string score value, got %#v", model)
	}
	if got := *model.ScoreString; got != longValue {
		t.Fatalf("expected full string round-trip, got length=%d want=%d", len(got), len(longValue))
	}
}
