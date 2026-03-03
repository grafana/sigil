package rules

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/worker"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"google.golang.org/protobuf/proto"
)

type Engine struct {
	store    engineStore
	now      func() time.Time
	cacheTTL time.Duration

	mu    sync.RWMutex
	cache map[string]ruleCacheEntry
}

type ruleCacheEntry struct {
	expiresAt  time.Time
	rules      []evalpkg.RuleDefinition
	evaluators map[string]evalpkg.EvaluatorDefinition
}

type engineStore interface {
	ListEnabledRules(ctx context.Context, tenantID string) ([]evalpkg.RuleDefinition, error)
	GetEvaluator(ctx context.Context, tenantID, evaluatorID string) (*evalpkg.EvaluatorDefinition, error)
	EnqueueWorkItem(ctx context.Context, item evalpkg.WorkItem) error
}

func NewEngine(store engineStore) *Engine {
	return &Engine{
		store:    store,
		now:      time.Now,
		cacheTTL: 10 * time.Second,
		cache:    map[string]ruleCacheEntry{},
	}
}

// InvalidateTenantCache clears the cached rule/evaluator snapshot for a tenant.
func (e *Engine) InvalidateTenantCache(tenantID string) {
	if e == nil {
		return
	}
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return
	}
	e.mu.Lock()
	delete(e.cache, tenantID)
	e.mu.Unlock()
}

func (e *Engine) OnGenerationsSaved(ctx context.Context, tenantID string, generations []GenerationRow) error {
	if e == nil || e.store == nil || strings.TrimSpace(tenantID) == "" || len(generations) == 0 {
		return nil
	}

	rules, evaluators, err := e.loadRules(ctx, tenantID)
	if err != nil {
		return err
	}
	if len(rules) == 0 {
		return nil
	}

	var firstErr error
	for _, row := range generations {
		generation, err := decodeGeneration(row)
		if err != nil {
			if firstErr == nil {
				firstErr = evalpkg.Permanent(err)
			}
			continue
		}
		conversationID := generation.GetConversationId()
		if conversationID == "" {
			conversationID = generation.GetId()
		}

		for _, rule := range rules {
			if !MatchesSelector(rule.Selector, generation) {
				continue
			}
			if !MatchesRule(rule.Match, generation) {
				continue
			}
			if !ShouldSampleConversation(tenantID, conversationID, rule.RuleID, rule.SampleRate) {
				continue
			}

			for _, evaluatorID := range rule.EvaluatorIDs {
				evaluator, ok := evaluators[evaluatorID]
				if !ok {
					worker.ObserveEnqueueError(tenantID)
					if firstErr == nil {
						firstErr = evalpkg.Permanent(fmt.Errorf("rule %q references missing evaluator %q", rule.RuleID, evaluatorID))
					}
					continue
				}
				item := evalpkg.WorkItem{
					TenantID:         tenantID,
					WorkID:           makeWorkID(tenantID, generation.GetId(), rule.RuleID, evaluator.EvaluatorID, evaluator.Version),
					GenerationID:     generation.GetId(),
					EvaluatorID:      evaluator.EvaluatorID,
					EvaluatorVersion: evaluator.Version,
					RuleID:           rule.RuleID,
					ScheduledAt:      e.now().UTC(),
					Status:           evalpkg.WorkItemStatusQueued,
				}
				if err := e.store.EnqueueWorkItem(ctx, item); err != nil {
					worker.ObserveEnqueueError(tenantID)
					if firstErr == nil {
						firstErr = err
					}
					continue
				}
				worker.ObserveEnqueue(tenantID, string(evaluator.Kind), rule.RuleID)
			}
		}
	}

	return firstErr
}

func (e *Engine) loadRules(ctx context.Context, tenantID string) ([]evalpkg.RuleDefinition, map[string]evalpkg.EvaluatorDefinition, error) {
	now := e.now().UTC()
	e.mu.RLock()
	cached, ok := e.cache[tenantID]
	e.mu.RUnlock()
	if ok && now.Before(cached.expiresAt) {
		return cached.rules, cached.evaluators, nil
	}

	rules, err := e.store.ListEnabledRules(ctx, tenantID)
	if err != nil {
		return nil, nil, err
	}
	evaluators := make(map[string]evalpkg.EvaluatorDefinition)
	for _, rule := range rules {
		for _, evaluatorID := range rule.EvaluatorIDs {
			if _, exists := evaluators[evaluatorID]; exists {
				continue
			}
			evaluator, err := e.store.GetEvaluator(ctx, tenantID, evaluatorID)
			if err != nil {
				return nil, nil, err
			}
			if evaluator == nil {
				continue
			}
			evaluators[evaluatorID] = *evaluator
		}
	}

	entry := ruleCacheEntry{
		expiresAt:  now.Add(e.cacheTTL),
		rules:      rules,
		evaluators: evaluators,
	}
	e.mu.Lock()
	e.cache[tenantID] = entry
	e.mu.Unlock()
	return entry.rules, entry.evaluators, nil
}

type GenerationRow struct {
	GenerationID   string
	ConversationID *string
	Payload        []byte
}

// DecodeGeneration unmarshals a GenerationRow into a Generation proto.
func DecodeGeneration(row GenerationRow) (*sigilv1.Generation, error) {
	return decodeGeneration(row)
}

func decodeGeneration(row GenerationRow) (*sigilv1.Generation, error) {
	if strings.TrimSpace(row.GenerationID) == "" {
		return nil, fmt.Errorf("generation id is required")
	}
	if len(row.Payload) == 0 {
		return nil, fmt.Errorf("generation payload is required")
	}
	var generation sigilv1.Generation
	if err := proto.Unmarshal(row.Payload, &generation); err != nil {
		return nil, fmt.Errorf("decode generation %q: %w", row.GenerationID, err)
	}
	return &generation, nil
}

func makeWorkID(tenantID, generationID, ruleID, evaluatorID, evaluatorVersion string) string {
	hash := sha1.Sum([]byte(tenantID + "|" + generationID + "|" + ruleID + "|" + evaluatorID + "|" + evaluatorVersion))
	return "work_" + hex.EncodeToString(hash[:12])
}
