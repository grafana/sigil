package modelcards

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"
)

type leaseState struct {
	OwnerID   string
	ExpiresAt time.Time
}

type MemoryStore struct {
	mu    sync.RWMutex
	cards map[string]Card
	runs  []RefreshRun
	lease map[string]leaseState
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		cards: make(map[string]Card),
		runs:  make([]RefreshRun, 0),
		lease: make(map[string]leaseState),
	}
}

func (s *MemoryStore) AutoMigrate(_ context.Context) error {
	return nil
}

func (s *MemoryStore) UpsertCards(_ context.Context, _ string, refreshedAt time.Time, cards []Card) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, card := range cards {
		existing, ok := s.cards[card.ModelKey]
		if ok {
			card.FirstSeenAt = existing.FirstSeenAt
		}
		card.LastSeenAt = refreshedAt.UTC()
		card.RefreshedAt = refreshedAt.UTC()
		s.cards[card.ModelKey] = cloneCard(card)
	}

	return len(cards), nil
}

func (s *MemoryStore) ListCards(_ context.Context, params ListParams) ([]Card, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	filtered := make([]Card, 0, len(s.cards))
	for _, card := range s.cards {
		if !matchesFilter(card, params) {
			continue
		}
		filtered = append(filtered, cloneCard(card))
	}

	sortCards(filtered, params.Sort, params.Order)
	if params.Offset >= len(filtered) {
		return []Card{}, false, nil
	}
	if params.Limit <= 0 {
		params.Limit = 50
	}
	end := params.Offset + params.Limit
	hasMore := false
	if end < len(filtered) {
		hasMore = true
	} else {
		end = len(filtered)
	}
	return filtered[params.Offset:end], hasMore, nil
}

func (s *MemoryStore) GetCardByModelKey(_ context.Context, modelKey string) (*Card, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	card, ok := s.cards[modelKey]
	if !ok {
		return nil, ErrNotFound
	}
	cloned := cloneCard(card)
	return &cloned, nil
}

func (s *MemoryStore) GetCardBySourceID(_ context.Context, source string, sourceModelID string) (*Card, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, card := range s.cards {
		if card.Source == source && card.SourceModelID == sourceModelID {
			cloned := cloneCard(card)
			return &cloned, nil
		}
	}
	return nil, ErrNotFound
}

func (s *MemoryStore) CountCards(_ context.Context) (int64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return int64(len(s.cards)), nil
}

func (s *MemoryStore) LatestRefreshedAt(_ context.Context) (*time.Time, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var latest *time.Time
	for _, card := range s.cards {
		if latest == nil || card.RefreshedAt.After(*latest) {
			value := card.RefreshedAt
			latest = &value
		}
	}
	return latest, nil
}

func (s *MemoryStore) RecordRefreshRun(_ context.Context, run RefreshRun) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.runs = append(s.runs, run)
	return nil
}

func (s *MemoryStore) LatestRefreshRun(_ context.Context, source string) (*RefreshRun, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for i := len(s.runs) - 1; i >= 0; i-- {
		if s.runs[i].Source == source {
			run := s.runs[i]
			return &run, nil
		}
	}
	return nil, ErrNotFound
}

func (s *MemoryStore) TryAcquireLease(_ context.Context, scopeKey string, ownerID string, now time.Time, ttl time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	lease, ok := s.lease[scopeKey]
	if !ok || lease.ExpiresAt.Before(now.UTC()) || lease.OwnerID == ownerID {
		s.lease[scopeKey] = leaseState{OwnerID: ownerID, ExpiresAt: now.UTC().Add(ttl)}
		return true, nil
	}
	return false, nil
}

func (s *MemoryStore) RenewLease(_ context.Context, scopeKey string, ownerID string, now time.Time, ttl time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	lease, ok := s.lease[scopeKey]
	if !ok || lease.OwnerID != ownerID {
		return false, nil
	}
	s.lease[scopeKey] = leaseState{OwnerID: ownerID, ExpiresAt: now.UTC().Add(ttl)}
	return true, nil
}

func (s *MemoryStore) ReleaseLease(_ context.Context, scopeKey string, ownerID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	lease, ok := s.lease[scopeKey]
	if !ok {
		return nil
	}
	if lease.OwnerID == ownerID {
		delete(s.lease, scopeKey)
	}
	return nil
}

func matchesFilter(card Card, params ListParams) bool {
	if params.Source != "" && card.Source != params.Source {
		return false
	}
	if params.Provider != "" && card.Provider != params.Provider {
		return false
	}
	if params.FreeOnly != nil && *params.FreeOnly && !card.IsFree {
		return false
	}
	if params.MinContextLength != nil {
		if card.ContextLength == nil || *card.ContextLength < *params.MinContextLength {
			return false
		}
	}
	if params.MaxPromptPriceUSDPerToken != nil {
		if card.Pricing.PromptUSDPerToken == nil || *card.Pricing.PromptUSDPerToken > *params.MaxPromptPriceUSDPerToken {
			return false
		}
	}
	if params.MaxCompletionPriceUSDPerToken != nil {
		if card.Pricing.CompletionUSDPerToken == nil || *card.Pricing.CompletionUSDPerToken > *params.MaxCompletionPriceUSDPerToken {
			return false
		}
	}
	if strings.TrimSpace(params.Q) != "" {
		q := strings.ToLower(strings.TrimSpace(params.Q))
		haystack := strings.ToLower(card.Name + " " + card.Provider + " " + card.SourceModelID)
		if !strings.Contains(haystack, q) {
			return false
		}
	}
	return true
}

func sortCards(cards []Card, sortBy string, order string) {
	desc := strings.EqualFold(order, "desc")
	sort.Slice(cards, func(i, j int) bool {
		left := cards[i]
		right := cards[j]
		var cmp int
		switch strings.ToLower(strings.TrimSpace(sortBy)) {
		case "provider":
			cmp = strings.Compare(left.Provider, right.Provider)
		case "prompt_price":
			cmp = compareFloatPointers(left.Pricing.PromptUSDPerToken, right.Pricing.PromptUSDPerToken)
		case "context_length":
			cmp = compareIntPointers(left.ContextLength, right.ContextLength)
		case "last_seen_at":
			if left.LastSeenAt.Before(right.LastSeenAt) {
				cmp = -1
			} else if left.LastSeenAt.After(right.LastSeenAt) {
				cmp = 1
			}
		default:
			cmp = strings.Compare(left.Name, right.Name)
		}
		if cmp == 0 {
			cmp = strings.Compare(left.ModelKey, right.ModelKey)
		}
		if desc {
			return cmp > 0
		}
		return cmp < 0
	})
}

func compareFloatPointers(left *float64, right *float64) int {
	if left == nil && right == nil {
		return 0
	}
	if left == nil {
		return 1
	}
	if right == nil {
		return -1
	}
	if *left < *right {
		return -1
	}
	if *left > *right {
		return 1
	}
	return 0
}

func compareIntPointers(left *int, right *int) int {
	if left == nil && right == nil {
		return 0
	}
	if left == nil {
		return 1
	}
	if right == nil {
		return -1
	}
	if *left < *right {
		return -1
	}
	if *left > *right {
		return 1
	}
	return 0
}

func cloneCard(card Card) Card {
	clone := card
	clone.InputModalities = append([]string{}, card.InputModalities...)
	clone.OutputModalities = append([]string{}, card.OutputModalities...)
	clone.SupportedParameters = append([]string{}, card.SupportedParameters...)
	return clone
}
