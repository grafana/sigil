package control

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func TestLoadYAMLSeed(t *testing.T) {
	store := &seedTestStore{}
	payload := []byte(`
evaluators:
  - id: custom.json_contract.v1
    kind: json_schema
    version: "2026-02-17"
    schema:
      type: object
      required: ["answer"]
    output:
      keys:
        - key: json.valid
          type: bool
rules:
  - id: online.json_contract
    enabled: true
    select:
      selector: user_visible_turn
    sample:
      rate: 0.5
    evaluators:
      - custom.json_contract.v1
`)

	if err := LoadYAMLSeed(context.Background(), store, "tenant-a", payload); err != nil {
		t.Fatalf("load yaml seed: %v", err)
	}
	if len(store.evaluators) != 1 {
		t.Fatalf("expected 1 evaluator, got %d", len(store.evaluators))
	}
	if len(store.rules) != 1 {
		t.Fatalf("expected 1 rule, got %d", len(store.rules))
	}
}

func TestLoadYAMLSeedRejectsInvalidYAML(t *testing.T) {
	store := &seedTestStore{}
	if err := LoadYAMLSeed(context.Background(), store, "tenant-a", []byte("evaluators: [")); err == nil {
		t.Fatalf("expected invalid yaml to fail")
	}
}

func TestLoadYAMLSeedRejectsDuplicateIDs(t *testing.T) {
	store := &seedTestStore{}
	payload := []byte(`
evaluators:
  - id: dup
    kind: heuristic
    output:
      keys:
        - key: one
          type: bool
  - id: dup
    kind: heuristic
    output:
      keys:
        - key: two
          type: bool
`)
	if err := LoadYAMLSeed(context.Background(), store, "tenant-a", payload); err == nil {
		t.Fatalf("expected duplicate evaluator ids to fail")
	}
}

func TestLoadYAMLSeedFile(t *testing.T) {
	store := &seedTestStore{}
	dir := t.TempDir()
	path := filepath.Join(dir, "seed.yaml")
	if err := os.WriteFile(path, []byte(`evaluators: []`), 0o600); err != nil {
		t.Fatalf("write seed file: %v", err)
	}
	if err := LoadYAMLSeedFile(context.Background(), store, "tenant-a", path); err != nil {
		t.Fatalf("load yaml seed file: %v", err)
	}
	if err := LoadYAMLSeedFile(context.Background(), store, "tenant-a", filepath.Join(dir, "missing.yaml")); err != nil {
		t.Fatalf("missing yaml seed file should not fail: %v", err)
	}
}

func TestSeedExampleFileParses(t *testing.T) {
	store := &seedTestStore{}
	paths := []string{
		filepath.Join("..", "..", "..", "..", "sigil-eval-seed.example.yaml"),
		filepath.Join("..", "sigil-eval-seed.example.yaml"),
	}
	var (
		payload []byte
		err     error
	)
	for _, path := range paths {
		payload, err = os.ReadFile(path)
		if err == nil {
			break
		}
	}
	if err != nil {
		t.Fatalf("read example seed file: %v", err)
	}
	if err := LoadYAMLSeed(context.Background(), store, "tenant-a", payload); err != nil {
		t.Fatalf("load example seed file: %v", err)
	}
	if len(store.evaluators) < 1 {
		t.Fatalf("expected evaluators from example seed")
	}
	if len(store.rules) < 1 {
		t.Fatalf("expected rules from example seed")
	}
}

func TestLoadYAMLSeedPreservesExplicitZeroSampleRate(t *testing.T) {
	store := &seedTestStore{}
	payload := []byte(`
evaluators:
  - id: eval.zero
    kind: heuristic
    output:
      keys:
        - key: zero
          type: bool
rules:
  - id: rule.zero
    select:
      selector: user_visible_turn
    sample:
      rate: 0
    evaluators:
      - eval.zero
`)

	if err := LoadYAMLSeed(context.Background(), store, "tenant-a", payload); err != nil {
		t.Fatalf("load yaml seed with explicit zero sample rate: %v", err)
	}
	if len(store.rules) != 1 {
		t.Fatalf("expected one seeded rule, got %d", len(store.rules))
	}
	if store.rules[0].SampleRate != 0 {
		t.Fatalf("expected explicit sample rate 0 to be preserved, got %v", store.rules[0].SampleRate)
	}
}

func TestLoadYAMLSeedDefaultsSampleRateToOneWhenOmitted(t *testing.T) {
	store := &seedTestStore{}
	payload := []byte(`
evaluators:
  - id: eval.default
    kind: heuristic
    output:
      keys:
        - key: default
          type: bool
rules:
  - id: rule.default
    select:
      selector: user_visible_turn
    evaluators:
      - eval.default
`)

	if err := LoadYAMLSeed(context.Background(), store, "tenant-a", payload); err != nil {
		t.Fatalf("load yaml seed with omitted sample rate: %v", err)
	}
	if len(store.rules) != 1 {
		t.Fatalf("expected one seeded rule, got %d", len(store.rules))
	}
	if store.rules[0].SampleRate != 1 {
		t.Fatalf("expected omitted sample rate to default to 1, got %v", store.rules[0].SampleRate)
	}
}

type seedTestStore struct {
	evaluators []evalpkg.EvaluatorDefinition
	rules      []evalpkg.RuleDefinition
}

func (s *seedTestStore) CreateEvaluator(_ context.Context, evaluator evalpkg.EvaluatorDefinition) error {
	s.evaluators = append(s.evaluators, evaluator)
	return nil
}

func (s *seedTestStore) CreateRule(_ context.Context, rule evalpkg.RuleDefinition) error {
	s.rules = append(s.rules, rule)
	return nil
}
