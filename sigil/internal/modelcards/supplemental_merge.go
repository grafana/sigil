package modelcards

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

func ValidateSupplementalAgainstSnapshot(snapshot Snapshot, supplemental *SupplementalCatalog) error {
	if supplemental == nil {
		return nil
	}
	_, err := MergeSupplementalCards(CardsFromSnapshot(snapshot, snapshot.CapturedAt), snapshot.CapturedAt, supplemental)
	if err != nil {
		return fmt.Errorf("%w: supplemental preflight merge failed: %v", ErrSupplementalInvalid, err)
	}
	return nil
}

func MergeSupplementalCards(base []Card, refreshedAt time.Time, supplemental *SupplementalCatalog) ([]Card, error) {
	if supplemental == nil {
		return cloneAndSortCardsByModelKey(base), nil
	}

	cardsByModelKey := make(map[string]Card, len(base)+len(supplemental.Models))
	for _, card := range base {
		cloned := cloneCard(card)
		cardsByModelKey[cloned.ModelKey] = cloned
	}

	sourceIndex := indexCardsBySourceModel(cardsByModelKey)
	sourceModelIDIndex := indexCardsBySourceModelID(cardsByModelKey)

	for _, model := range supplemental.Models {
		card := supplementalModelToCard(model, refreshedAt)
		if _, exists := cardsByModelKey[card.ModelKey]; exists {
			return nil, fmt.Errorf("%w: supplemental model_key %q already exists in base catalog", ErrSupplementalInvalid, card.ModelKey)
		}
		sourceModelIDKey := sourceModelIDLookupKey(card.SourceModelID)
		if existing := sourceModelIDIndex[sourceModelIDKey]; len(existing) > 0 {
			// Base catalog entries take precedence when source_model_id overlaps.
			continue
		}
		sourceKey := sourceModelLookupKey(card.Source, card.SourceModelID)

		cardsByModelKey[card.ModelKey] = card
		sourceIndex[sourceKey] = []string{card.ModelKey}
		sourceModelIDIndex[sourceModelIDKey] = []string{card.ModelKey}
	}

	for _, patch := range supplemental.Patches {
		targetSource := normalizeSupplementalTargetSource(patch.TargetSource)
		targetKey := sourceModelLookupKey(targetSource, patch.TargetSourceModelID)
		targetModelKeys := sourceIndex[targetKey]
		if len(targetModelKeys) == 0 {
			return nil, fmt.Errorf("%w: supplemental patch target not found: %s", ErrSupplementalInvalid, targetKey)
		}
		if len(targetModelKeys) > 1 {
			return nil, fmt.Errorf("%w: supplemental patch target is ambiguous: %s", ErrSupplementalInvalid, targetKey)
		}

		modelKey := targetModelKeys[0]
		card := cardsByModelKey[modelKey]
		patched, err := applySupplementalPatch(card, patch)
		if err != nil {
			return nil, err
		}
		cardsByModelKey[modelKey] = patched
	}

	out := make([]Card, 0, len(cardsByModelKey))
	for _, card := range cardsByModelKey {
		out = append(out, card)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].ModelKey < out[j].ModelKey
	})
	return out, nil
}

func cloneAndSortCardsByModelKey(cards []Card) []Card {
	out := make([]Card, 0, len(cards))
	for _, card := range cards {
		out = append(out, cloneCard(card))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].ModelKey < out[j].ModelKey
	})
	return out
}

func indexCardsBySourceModel(cardsByModelKey map[string]Card) map[string][]string {
	sourceIndex := make(map[string][]string, len(cardsByModelKey))
	for _, card := range cardsByModelKey {
		sourceKey := sourceModelLookupKey(card.Source, card.SourceModelID)
		sourceIndex[sourceKey] = append(sourceIndex[sourceKey], card.ModelKey)
	}
	for key := range sourceIndex {
		sort.Strings(sourceIndex[key])
	}
	return sourceIndex
}

func indexCardsBySourceModelID(cardsByModelKey map[string]Card) map[string][]string {
	sourceModelIDIndex := make(map[string][]string, len(cardsByModelKey))
	for _, card := range cardsByModelKey {
		modelIDKey := sourceModelIDLookupKey(card.SourceModelID)
		sourceModelIDIndex[modelIDKey] = append(sourceModelIDIndex[modelIDKey], card.ModelKey)
	}
	for key := range sourceModelIDIndex {
		sort.Strings(sourceModelIDIndex[key])
	}
	return sourceModelIDIndex
}

func sourceModelLookupKey(source string, sourceModelID string) string {
	return strings.TrimSpace(strings.ToLower(source)) + "\x00" + strings.TrimSpace(strings.ToLower(sourceModelID))
}

func sourceModelIDLookupKey(sourceModelID string) string {
	return strings.TrimSpace(strings.ToLower(sourceModelID))
}

func supplementalModelToCard(model SupplementalModel, refreshedAt time.Time) Card {
	card := Card{
		ModelKey:            strings.TrimSpace(model.ModelKey),
		Source:              SourceSupplemental,
		SourceModelID:       strings.TrimSpace(model.SourceModelID),
		CanonicalSlug:       strings.TrimSpace(model.CanonicalSlug),
		Name:                strings.TrimSpace(model.Name),
		Provider:            strings.TrimSpace(model.Provider),
		Description:         strings.TrimSpace(model.Description),
		ContextLength:       copyIntPtr(model.ContextLength),
		Modality:            strings.TrimSpace(model.Modality),
		InputModalities:     append([]string(nil), model.InputModalities...),
		OutputModalities:    append([]string(nil), model.OutputModalities...),
		SupportedParameters: append([]string(nil), model.SupportedParameters...),
		Tokenizer:           strings.TrimSpace(model.Tokenizer),
		Pricing:             copyPricing(model.Pricing),
		IsFree:              model.IsFree,
		TopProvider:         copyTopProvider(model.TopProvider),
		ExpiresAt:           copyTimePtr(model.ExpiresAt),
		FirstSeenAt:         refreshedAt.UTC(),
		LastSeenAt:          refreshedAt.UTC(),
		RefreshedAt:         refreshedAt.UTC(),
		RawPayloadJSON:      "{}",
	}
	return card
}

func applySupplementalPatch(card Card, patch SupplementalPatch) (Card, error) {
	if patch.CanonicalSlug != nil {
		card.CanonicalSlug = strings.TrimSpace(*patch.CanonicalSlug)
	}
	if patch.Name != nil {
		card.Name = strings.TrimSpace(*patch.Name)
	}
	if patch.Provider != nil {
		card.Provider = strings.TrimSpace(*patch.Provider)
	}
	if patch.Description != nil {
		card.Description = strings.TrimSpace(*patch.Description)
	}
	if patch.ContextLength != nil {
		if *patch.ContextLength < 0 {
			return Card{}, fmt.Errorf("%w: patch context_length must be >= 0", ErrSupplementalInvalid)
		}
		card.ContextLength = copyIntPtr(patch.ContextLength)
	}
	if patch.Modality != nil {
		card.Modality = strings.TrimSpace(*patch.Modality)
	}
	if patch.InputModalities != nil {
		card.InputModalities = cleanStrings(*patch.InputModalities)
	}
	if patch.OutputModalities != nil {
		card.OutputModalities = cleanStrings(*patch.OutputModalities)
	}
	if patch.SupportedParameters != nil {
		card.SupportedParameters = cleanStrings(*patch.SupportedParameters)
	}
	if patch.Tokenizer != nil {
		card.Tokenizer = strings.TrimSpace(*patch.Tokenizer)
	}
	if patch.Pricing != nil {
		applySupplementalPricingPatch(&card.Pricing, *patch.Pricing)
	}
	if patch.IsFree != nil {
		card.IsFree = *patch.IsFree
	}
	if patch.TopProvider != nil {
		if patch.TopProvider.ContextLength != nil && *patch.TopProvider.ContextLength < 0 {
			return Card{}, fmt.Errorf("%w: patch top_provider.context_length must be >= 0", ErrSupplementalInvalid)
		}
		if patch.TopProvider.MaxCompletionTokens != nil && *patch.TopProvider.MaxCompletionTokens < 0 {
			return Card{}, fmt.Errorf("%w: patch top_provider.max_completion_tokens must be >= 0", ErrSupplementalInvalid)
		}
		applySupplementalTopProviderPatch(&card.TopProvider, *patch.TopProvider)
	}
	if patch.ExpiresAt != nil {
		card.ExpiresAt = copyTimePtr(patch.ExpiresAt)
	}

	return card, nil
}

func applySupplementalPricingPatch(pricing *Pricing, patch SupplementalPricingPatch) {
	if patch.PromptUSDPerToken != nil {
		pricing.PromptUSDPerToken = copyFloatPtr(patch.PromptUSDPerToken)
	}
	if patch.CompletionUSDPerToken != nil {
		pricing.CompletionUSDPerToken = copyFloatPtr(patch.CompletionUSDPerToken)
	}
	if patch.RequestUSD != nil {
		pricing.RequestUSD = copyFloatPtr(patch.RequestUSD)
	}
	if patch.ImageUSD != nil {
		pricing.ImageUSD = copyFloatPtr(patch.ImageUSD)
	}
	if patch.WebSearchUSD != nil {
		pricing.WebSearchUSD = copyFloatPtr(patch.WebSearchUSD)
	}
	if patch.InputCacheReadUSDPerToken != nil {
		pricing.InputCacheReadUSDPerToken = copyFloatPtr(patch.InputCacheReadUSDPerToken)
	}
	if patch.InputCacheWriteUSDPerToken != nil {
		pricing.InputCacheWriteUSDPerToken = copyFloatPtr(patch.InputCacheWriteUSDPerToken)
	}
}

func applySupplementalTopProviderPatch(topProvider *TopProvider, patch SupplementalTopProviderPatch) {
	if patch.ContextLength != nil {
		topProvider.ContextLength = copyIntPtr(patch.ContextLength)
	}
	if patch.MaxCompletionTokens != nil {
		topProvider.MaxCompletionTokens = copyIntPtr(patch.MaxCompletionTokens)
	}
	if patch.IsModerated != nil {
		v := *patch.IsModerated
		topProvider.IsModerated = &v
	}
}

func copyPricing(pricing Pricing) Pricing {
	return Pricing{
		PromptUSDPerToken:          copyFloatPtr(pricing.PromptUSDPerToken),
		CompletionUSDPerToken:      copyFloatPtr(pricing.CompletionUSDPerToken),
		RequestUSD:                 copyFloatPtr(pricing.RequestUSD),
		ImageUSD:                   copyFloatPtr(pricing.ImageUSD),
		WebSearchUSD:               copyFloatPtr(pricing.WebSearchUSD),
		InputCacheReadUSDPerToken:  copyFloatPtr(pricing.InputCacheReadUSDPerToken),
		InputCacheWriteUSDPerToken: copyFloatPtr(pricing.InputCacheWriteUSDPerToken),
	}
}

func copyTopProvider(value TopProvider) TopProvider {
	out := TopProvider{
		ContextLength:       copyIntPtr(value.ContextLength),
		MaxCompletionTokens: copyIntPtr(value.MaxCompletionTokens),
	}
	if value.IsModerated != nil {
		v := *value.IsModerated
		out.IsModerated = &v
	}
	return out
}

func copyFloatPtr(value *float64) *float64 {
	if value == nil {
		return nil
	}
	v := *value
	return &v
}

func copyIntPtr(value *int) *int {
	if value == nil {
		return nil
	}
	v := *value
	return &v
}

func copyTimePtr(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	v := value.UTC()
	return &v
}
