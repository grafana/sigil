package sigil

import (
	"context"
	"errors"
	"hash/fnv"
	"strings"
	"testing"
	"time"

	"github.com/grafana/sigil/sigil/internal/config"
	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	evalenqueue "github.com/grafana/sigil/sigil/internal/eval/enqueue"
	evalrules "github.com/grafana/sigil/sigil/internal/eval/rules"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	generationingest "github.com/grafana/sigil/sigil/internal/ingest/generation"
	"github.com/grafana/sigil/sigil/internal/storage"
	"google.golang.org/protobuf/proto"
)

func TestBuildGenerationStoreRejectsMemoryBackend(t *testing.T) {
	_, err := buildGenerationStore(context.Background(), config.Config{
		Target:         config.TargetServer,
		StorageBackend: "memory",
	}, shouldAutoMigrateGenerationStoreTarget(config.TargetServer))
	if err == nil {
		t.Fatalf("expected unsupported backend error")
	}
	if !strings.Contains(err.Error(), "unsupported storage backend") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildFeedbackStoreRejectsNonFeedbackStore(t *testing.T) {
	_, err := buildFeedbackStore("mysql", generationingest.NewMemoryStore())
	if err == nil {
		t.Fatalf("expected feedback store compatibility error")
	}
	if !strings.Contains(err.Error(), "does not support feedback storage") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildScoreGenerationLookupFallsBackToColdTier(t *testing.T) {
	lookup := buildScoreGenerationLookup(
		&scoreLookupWALReaderStub{},
		&scoreLookupMetadataStoreStub{
			blocks: []storage.BlockMeta{{BlockID: "block-1"}},
		},
		&scoreLookupBlockReaderStub{
			indexByBlock: map[string]*storage.BlockIndex{
				"block-1": {
					Entries: []storage.IndexEntry{{
						GenerationIDHash: hashIDForTest("gen-cold"),
						Offset:           10,
						Length:           100,
					}},
				},
			},
			generationsByBlock: map[string][]*sigilv1.Generation{
				"block-1": {{Id: "gen-cold"}},
			},
		},
	)
	if lookup == nil {
		t.Fatalf("expected non-nil lookup")
	}

	generation, err := lookup.GetByID(context.Background(), "tenant-a", "gen-cold")
	if err != nil {
		t.Fatalf("expected cold lookup to succeed, got %v", err)
	}
	if generation == nil || generation.GetId() != "gen-cold" {
		t.Fatalf("expected cold generation gen-cold, got %#v", generation)
	}
}

type scoreLookupWALReaderStub struct{}

func (s *scoreLookupWALReaderStub) GetByID(context.Context, string, string) (*sigilv1.Generation, error) {
	return nil, nil
}

func (s *scoreLookupWALReaderStub) GetByConversationID(context.Context, string, string) ([]*sigilv1.Generation, error) {
	return []*sigilv1.Generation{}, nil
}

type scoreLookupMetadataStoreStub struct {
	blocks []storage.BlockMeta
}

func (s *scoreLookupMetadataStoreStub) InsertBlock(context.Context, storage.BlockMeta) error {
	return nil
}

func (s *scoreLookupMetadataStoreStub) ListBlocks(context.Context, string, time.Time, time.Time) ([]storage.BlockMeta, error) {
	return append([]storage.BlockMeta(nil), s.blocks...), nil
}

type scoreLookupBlockReaderStub struct {
	indexByBlock       map[string]*storage.BlockIndex
	generationsByBlock map[string][]*sigilv1.Generation
}

func (s *scoreLookupBlockReaderStub) ReadIndex(_ context.Context, _ string, blockID string) (*storage.BlockIndex, error) {
	index, ok := s.indexByBlock[blockID]
	if !ok {
		return &storage.BlockIndex{Entries: []storage.IndexEntry{}}, nil
	}
	return index, nil
}

func (s *scoreLookupBlockReaderStub) ReadGenerations(_ context.Context, _ string, blockID string, _ []storage.IndexEntry) ([]*sigilv1.Generation, error) {
	generations, ok := s.generationsByBlock[blockID]
	if !ok {
		return []*sigilv1.Generation{}, nil
	}
	return generations, nil
}

func hashIDForTest(value string) uint64 {
	hasher := fnv.New64a()
	_, _ = hasher.Write([]byte(value))
	return hasher.Sum64()
}

func TestShouldLoadEvalSeed(t *testing.T) {
	testCases := []struct {
		name              string
		store             evalSeedStateStore
		tenantID          string
		expectedLoad      bool
		expectedErrSubstr string
	}{
		{
			name:         "nil store skips",
			store:        nil,
			tenantID:     "tenant-a",
			expectedLoad: false,
		},
		{
			name:         "empty tenant skips",
			store:        &evalSeedStateStoreStub{},
			tenantID:     "",
			expectedLoad: false,
		},
		{
			name: "loads when tenant has no config",
			store: &evalSeedStateStoreStub{
				evaluators: []evalpkg.EvaluatorDefinition{},
				rules:      []evalpkg.RuleDefinition{},
			},
			tenantID:     "tenant-a",
			expectedLoad: true,
		},
		{
			name: "skips when evaluators already exist",
			store: &evalSeedStateStoreStub{
				evaluators: []evalpkg.EvaluatorDefinition{{EvaluatorID: "custom.eval"}},
			},
			tenantID:     "tenant-a",
			expectedLoad: false,
		},
		{
			name: "skips when rules already exist",
			store: &evalSeedStateStoreStub{
				rules: []evalpkg.RuleDefinition{{RuleID: "custom.rule"}},
			},
			tenantID:     "tenant-a",
			expectedLoad: false,
		},
		{
			name: "returns evaluator listing errors",
			store: &evalSeedStateStoreStub{
				listEvaluatorsErr: errors.New("boom"),
			},
			tenantID:          "tenant-a",
			expectedErrSubstr: "list evaluators",
		},
		{
			name: "returns rule listing errors",
			store: &evalSeedStateStoreStub{
				listRulesErr: errors.New("boom"),
			},
			tenantID:          "tenant-a",
			expectedErrSubstr: "list rules",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			load, err := shouldLoadEvalSeed(context.Background(), testCase.store, testCase.tenantID)
			if testCase.expectedErrSubstr != "" {
				if err == nil || !strings.Contains(err.Error(), testCase.expectedErrSubstr) {
					t.Fatalf("expected error containing %q, got %v", testCase.expectedErrSubstr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("expected no error, got %v", err)
			}
			if load != testCase.expectedLoad {
				t.Fatalf("expected load=%v, got %v", testCase.expectedLoad, load)
			}
		})
	}
}

func TestEvalEnqueueProcessorAdapterInvalidatesTenantCacheBeforeProcessing(t *testing.T) {
	store := &evalEnqueueProcessorTestStore{
		rules: []evalpkg.RuleDefinition{{
			TenantID:     "tenant-a",
			RuleID:       "rule-1",
			Enabled:      true,
			Selector:     evalpkg.SelectorAllAssistantGenerations,
			Match:        map[string]any{},
			SampleRate:   1,
			EvaluatorIDs: []string{"eval.helpfulness"},
		}},
		evaluatorVersion: "v1",
	}
	engine := evalrules.NewEngine(store)
	adapter := evalEnqueueProcessorAdapter{engine: engine}

	event1 := evalenqueue.Event{
		TenantID:     "tenant-a",
		GenerationID: "gen-1",
		Payload:      marshalEvalTestGeneration(t, "gen-1"),
	}
	if err := adapter.Process(context.Background(), event1); err != nil {
		t.Fatalf("process event1: %v", err)
	}
	if len(store.enqueued) != 1 {
		t.Fatalf("expected one enqueued item after first event, got %d", len(store.enqueued))
	}
	if store.enqueued[0].EvaluatorVersion != "v1" {
		t.Fatalf("expected first event evaluator version v1, got %q", store.enqueued[0].EvaluatorVersion)
	}

	store.evaluatorVersion = "v2"
	event2 := evalenqueue.Event{
		TenantID:     "tenant-a",
		GenerationID: "gen-2",
		Payload:      marshalEvalTestGeneration(t, "gen-2"),
	}
	if err := adapter.Process(context.Background(), event2); err != nil {
		t.Fatalf("process event2: %v", err)
	}
	if len(store.enqueued) != 2 {
		t.Fatalf("expected two enqueued items after second event, got %d", len(store.enqueued))
	}
	if store.enqueued[1].EvaluatorVersion != "v2" {
		t.Fatalf("expected second event to use refreshed evaluator version v2, got %q", store.enqueued[1].EvaluatorVersion)
	}
	if store.listRulesCalls < 2 {
		t.Fatalf("expected per-event cache invalidation to force reload, list rules calls=%d", store.listRulesCalls)
	}
}

func marshalEvalTestGeneration(t *testing.T, generationID string) []byte {
	t.Helper()
	payload, err := proto.Marshal(&sigilv1.Generation{
		Id: generationID,
		Output: []*sigilv1.Message{{
			Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
			Parts: []*sigilv1.Part{{
				Payload: &sigilv1.Part_Text{Text: "hello"},
			}},
		}},
	})
	if err != nil {
		t.Fatalf("marshal generation: %v", err)
	}
	return payload
}

type evalSeedStateStoreStub struct {
	evaluators        []evalpkg.EvaluatorDefinition
	rules             []evalpkg.RuleDefinition
	listEvaluatorsErr error
	listRulesErr      error
}

type evalEnqueueProcessorTestStore struct {
	rules            []evalpkg.RuleDefinition
	evaluatorVersion string
	enqueued         []evalpkg.WorkItem
	listRulesCalls   int
}

func (s *evalEnqueueProcessorTestStore) ListEnabledRules(_ context.Context, _ string) ([]evalpkg.RuleDefinition, error) {
	s.listRulesCalls++
	return append([]evalpkg.RuleDefinition(nil), s.rules...), nil
}

func (s *evalEnqueueProcessorTestStore) GetEvaluator(_ context.Context, _ string, evaluatorID string) (*evalpkg.EvaluatorDefinition, error) {
	if evaluatorID != "eval.helpfulness" {
		return nil, nil
	}
	return &evalpkg.EvaluatorDefinition{
		EvaluatorID: evaluatorID,
		Version:     s.evaluatorVersion,
		Kind:        evalpkg.EvaluatorKindHeuristic,
	}, nil
}

func (s *evalEnqueueProcessorTestStore) EnqueueWorkItem(_ context.Context, item evalpkg.WorkItem) error {
	s.enqueued = append(s.enqueued, item)
	return nil
}

func (s *evalSeedStateStoreStub) ListEvaluators(_ context.Context, _ string, _ int, _ uint64) ([]evalpkg.EvaluatorDefinition, uint64, error) {
	if s.listEvaluatorsErr != nil {
		return nil, 0, s.listEvaluatorsErr
	}
	return append([]evalpkg.EvaluatorDefinition(nil), s.evaluators...), 0, nil
}

func (s *evalSeedStateStoreStub) ListRules(_ context.Context, _ string, _ int, _ uint64) ([]evalpkg.RuleDefinition, uint64, error) {
	if s.listRulesErr != nil {
		return nil, 0, s.listRulesErr
	}
	return append([]evalpkg.RuleDefinition(nil), s.rules...), 0, nil
}
