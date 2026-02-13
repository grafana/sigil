package modelcards

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Source interface {
	Name() string
	Fetch(ctx context.Context) ([]Card, error)
}

type OpenRouterSource struct {
	baseURL string
	client  *http.Client
}

func NewOpenRouterSource(sourceTimeout time.Duration) *OpenRouterSource {
	if sourceTimeout <= 0 {
		sourceTimeout = 15 * time.Second
	}

	return &OpenRouterSource{
		baseURL: "https://openrouter.ai/api/v1/models",
		client: &http.Client{
			Timeout: sourceTimeout,
		},
	}
}

func (s *OpenRouterSource) Name() string {
	return SourceOpenRouter
}

func (s *OpenRouterSource) Fetch(ctx context.Context) ([]Card, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request openrouter models: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openrouter returned status %d", resp.StatusCode)
	}

	var decoded openRouterModelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, fmt.Errorf("decode openrouter response: %w", err)
	}

	now := time.Now().UTC()
	cards := make([]Card, 0, len(decoded.Data))
	for _, model := range decoded.Data {
		card := Card{
			ModelKey:            modelKey(SourceOpenRouter, model.ID),
			Source:              SourceOpenRouter,
			SourceModelID:       model.ID,
			CanonicalSlug:       strings.TrimSpace(model.CanonicalSlug),
			Name:                strings.TrimSpace(model.Name),
			Provider:            providerFromModelID(model.ID),
			Description:         strings.TrimSpace(model.Description),
			ContextLength:       nullableInt(model.ContextLength),
			Modality:            strings.TrimSpace(model.Architecture.Modality),
			InputModalities:     cleanStrings(model.Architecture.InputModalities),
			OutputModalities:    cleanStrings(model.Architecture.OutputModalities),
			SupportedParameters: cleanStrings(model.SupportedParameters),
			Tokenizer:           strings.TrimSpace(model.Architecture.Tokenizer),
			Pricing: Pricing{
				PromptUSDPerToken:          parsePrice(model.Pricing.Prompt),
				CompletionUSDPerToken:      parsePrice(model.Pricing.Completion),
				RequestUSD:                 parsePrice(model.Pricing.Request),
				ImageUSD:                   parsePrice(model.Pricing.Image),
				WebSearchUSD:               parsePrice(model.Pricing.WebSearch),
				InputCacheReadUSDPerToken:  parsePrice(model.Pricing.InputCacheRead),
				InputCacheWriteUSDPerToken: parsePrice(model.Pricing.InputCacheWrite),
			},
			TopProvider: TopProvider{
				ContextLength:       nullableInt(model.TopProvider.ContextLength),
				MaxCompletionTokens: nullableInt(model.TopProvider.MaxCompletionTokens),
				IsModerated:         nullableBool(model.TopProvider.IsModerated),
			},
			ExpiresAt:      parseDate(model.ExpirationDate),
			FirstSeenAt:    now,
			LastSeenAt:     now,
			RefreshedAt:    now,
			RawPayloadJSON: "{}",
		}

		card.IsFree = isFreeModel(card, model.ID)
		cards = append(cards, card)
	}

	sort.Slice(cards, func(i, j int) bool {
		return cards[i].ModelKey < cards[j].ModelKey
	})

	return cards, nil
}

type StaticErrorSource struct {
	err error
}

func NewStaticErrorSource(err error) *StaticErrorSource {
	return &StaticErrorSource{err: err}
}

func (s *StaticErrorSource) Name() string {
	return SourceOpenRouter
}

func (s *StaticErrorSource) Fetch(_ context.Context) ([]Card, error) {
	if s.err == nil {
		return nil, fmt.Errorf("source unavailable")
	}
	return nil, s.err
}

type openRouterModelsResponse struct {
	Data []openRouterModel `json:"data"`
}

type openRouterModel struct {
	ID                  string                 `json:"id"`
	CanonicalSlug       string                 `json:"canonical_slug"`
	Name                string                 `json:"name"`
	Description         string                 `json:"description"`
	ContextLength       int                    `json:"context_length"`
	SupportedParameters []string               `json:"supported_parameters"`
	ExpirationDate      *string                `json:"expiration_date"`
	Architecture        openRouterArchitecture `json:"architecture"`
	Pricing             openRouterPricing      `json:"pricing"`
	TopProvider         openRouterTopProvider  `json:"top_provider"`
}

type openRouterArchitecture struct {
	Modality         string   `json:"modality"`
	InputModalities  []string `json:"input_modalities"`
	OutputModalities []string `json:"output_modalities"`
	Tokenizer        string   `json:"tokenizer"`
}

type openRouterPricing struct {
	Prompt          string `json:"prompt"`
	Completion      string `json:"completion"`
	Request         string `json:"request"`
	Image           string `json:"image"`
	WebSearch       string `json:"web_search"`
	InputCacheRead  string `json:"input_cache_read"`
	InputCacheWrite string `json:"input_cache_write"`
}

type openRouterTopProvider struct {
	ContextLength       int  `json:"context_length"`
	MaxCompletionTokens int  `json:"max_completion_tokens"`
	IsModerated         bool `json:"is_moderated"`
}

func modelKey(source string, sourceModelID string) string {
	return fmt.Sprintf("%s:%s", source, sourceModelID)
}

func providerFromModelID(sourceModelID string) string {
	parts := strings.SplitN(sourceModelID, "/", 2)
	if len(parts) == 2 {
		return strings.TrimSpace(parts[0])
	}
	return ""
}

func cleanStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		cleaned = append(cleaned, value)
	}
	if len(cleaned) == 0 {
		return nil
	}
	return cleaned
}

func parsePrice(raw string) *float64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return nil
	}
	return &value
}

func parseDate(value *string) *time.Time {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	parsed, err := time.Parse("2006-01-02", trimmed)
	if err != nil {
		return nil
	}
	parsed = parsed.UTC()
	return &parsed
}

func nullableInt(value int) *int {
	if value <= 0 {
		return nil
	}
	v := value
	return &v
}

func nullableBool(value bool) *bool {
	v := value
	return &v
}

func isFreeModel(card Card, sourceModelID string) bool {
	if strings.Contains(sourceModelID, ":free") {
		return true
	}
	if card.Pricing.PromptUSDPerToken != nil && card.Pricing.CompletionUSDPerToken != nil {
		if *card.Pricing.PromptUSDPerToken == 0 && *card.Pricing.CompletionUSDPerToken == 0 {
			return true
		}
	}
	if card.Pricing.PromptUSDPerToken != nil && *card.Pricing.PromptUSDPerToken == 0 {
		return true
	}
	return false
}
