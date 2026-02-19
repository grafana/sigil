package modelcards

import (
	"context"
	"strings"
)

const (
	resolveBatchPageSize = 200
)

func (s *Service) ResolveBatch(ctx context.Context, inputs []ResolveInput) ([]ResolveResult, Freshness, error) {
	path, freshness, err := s.readPath(ctx)
	if err != nil {
		return nil, Freshness{}, err
	}
	freshness.SourcePath = path
	observeReadPath("resolve", path)
	s.observeCatalogState(ctx)

	cards, err := s.cardsForResolve(ctx, path)
	if err != nil {
		return nil, freshness, err
	}

	index := newResolveIndex(cards)
	results := make([]ResolveResult, 0, len(inputs))
	for _, input := range inputs {
		results = append(results, index.resolve(input))
	}

	return results, freshness, nil
}

func (s *Service) cardsForResolve(ctx context.Context, path string) ([]Card, error) {
	if path == SourcePathSnapshotFallback {
		return s.snapshotCards(s.now())
	}

	cards := make([]Card, 0, resolveBatchPageSize)
	offset := 0
	for {
		page, hasMore, err := s.store.ListCards(ctx, ListParams{
			Limit:  resolveBatchPageSize,
			Offset: offset,
		})
		if err != nil {
			return nil, err
		}
		cards = append(cards, page...)
		if !hasMore || len(page) == 0 {
			break
		}
		offset += len(page)
	}
	return cards, nil
}

type resolveIndex struct {
	mapped     map[string]map[string]map[string]Card
	exact      map[string]map[string]map[string]Card
	normalized map[string]map[string]map[string]Card
}

func newResolveIndex(cards []Card) resolveIndex {
	index := resolveIndex{
		mapped:     make(map[string]map[string]map[string]Card),
		exact:      make(map[string]map[string]map[string]Card),
		normalized: make(map[string]map[string]map[string]Card),
	}

	cardsBySourceModelID := make(map[string]map[string]Card, len(cards))
	for _, card := range cards {
		sourceModelID := strings.ToLower(strings.TrimSpace(card.SourceModelID))
		if sourceModelID != "" {
			cardSet := cardsBySourceModelID[sourceModelID]
			if cardSet == nil {
				cardSet = make(map[string]Card)
				cardsBySourceModelID[sourceModelID] = cardSet
			}
			cardSet[card.ModelKey] = card
		}

		provider := resolveProviderForCard(card)
		if provider == "" {
			continue
		}

		aliases := resolveAliasesForCard(card)
		for _, alias := range aliases {
			index.addExact(provider, alias, card)
			index.addNormalized(provider, normalizeResolveAlias(alias), card)
		}
	}

	for _, rule := range resolveMappedAliasRules {
		targetID := strings.ToLower(strings.TrimSpace(rule.TargetSourceModelID))
		if targetID == "" {
			continue
		}
		targetSet := cardsBySourceModelID[targetID]
		if len(targetSet) != 1 {
			continue
		}
		card := singleResolveCard(targetSet)
		index.addMapped(rule.Provider, rule.Alias, card)
	}
	return index
}

func (i *resolveIndex) addMapped(provider string, alias string, card Card) {
	provider = strings.TrimSpace(strings.ToLower(provider))
	alias = strings.TrimSpace(alias)
	if provider == "" || alias == "" {
		return
	}
	providerMap := i.mapped[provider]
	if providerMap == nil {
		providerMap = make(map[string]map[string]Card)
		i.mapped[provider] = providerMap
	}
	cardMap := providerMap[alias]
	if cardMap == nil {
		cardMap = make(map[string]Card)
		providerMap[alias] = cardMap
	}
	cardMap[card.ModelKey] = card

	lowerAlias := strings.ToLower(alias)
	if lowerAlias == alias {
		return
	}
	lowerMap := providerMap[lowerAlias]
	if lowerMap == nil {
		lowerMap = make(map[string]Card)
		providerMap[lowerAlias] = lowerMap
	}
	lowerMap[card.ModelKey] = card
}

func (i *resolveIndex) addExact(provider string, alias string, card Card) {
	alias = strings.TrimSpace(alias)
	if alias == "" {
		return
	}
	providerMap, ok := i.exact[provider]
	if !ok {
		providerMap = make(map[string]map[string]Card)
		i.exact[provider] = providerMap
	}
	cardMap, ok := providerMap[alias]
	if !ok {
		cardMap = make(map[string]Card)
		providerMap[alias] = cardMap
	}
	cardMap[card.ModelKey] = card
}

func (i *resolveIndex) addNormalized(provider string, alias string, card Card) {
	if alias == "" {
		return
	}
	providerMap, ok := i.normalized[provider]
	if !ok {
		providerMap = make(map[string]map[string]Card)
		i.normalized[provider] = providerMap
	}
	cardMap, ok := providerMap[alias]
	if !ok {
		cardMap = make(map[string]Card)
		providerMap[alias] = cardMap
	}
	cardMap[card.ModelKey] = card
}

func (i resolveIndex) resolve(input ResolveInput) ResolveResult {
	provider := strings.TrimSpace(input.Provider)
	model := strings.TrimSpace(input.Model)
	result := ResolveResult{
		Provider: provider,
		Model:    model,
		Status:   ResolveStatusUnresolved,
	}
	if provider == "" || model == "" {
		result.Reason = ResolveReasonInvalidInput
		return result
	}

	if i.tryResolveMappedAlias(&result, provider, model) {
		return result
	}

	candidates := buildResolveCandidates(provider, model)

	if i.tryResolveWithCollector(
		&result,
		model,
		ResolveMatchStrategyExact,
		candidates.ProviderCandidates,
		candidates.ModelCandidates,
		i.collectExactMatches,
	) {
		return result
	}
	if len(candidates.RelaxedModelCandidates) > 0 && i.tryResolveWithCollector(
		&result,
		model,
		ResolveMatchStrategyExact,
		candidates.ProviderCandidates,
		candidates.RelaxedModelCandidates,
		i.collectExactMatches,
	) {
		return result
	}
	if i.tryResolveWithCollector(
		&result,
		model,
		ResolveMatchStrategyNormalized,
		candidates.ProviderCandidates,
		candidates.ModelCandidates,
		i.collectNormalizedMatches,
	) {
		return result
	}
	if len(candidates.RelaxedModelCandidates) > 0 && i.tryResolveWithCollector(
		&result,
		model,
		ResolveMatchStrategyNormalized,
		candidates.ProviderCandidates,
		candidates.RelaxedModelCandidates,
		i.collectNormalizedMatches,
	) {
		return result
	}

	result.Reason = ResolveReasonNotFound
	return result
}

type resolveCandidates struct {
	ModelCandidates        []string
	RelaxedModelCandidates []string
	ProviderCandidates     []string
}

type resolveCollector func(providerCandidates []string, modelCandidates []string) map[string]Card

func buildResolveCandidates(provider string, model string) resolveCandidates {
	modelCandidates, providerHints := resolveInputModelCandidates(model)
	relaxedModelCandidates := collectRelaxedResolveModelCandidates(modelCandidates)
	allModelCandidates := mergeResolveCandidates(modelCandidates, relaxedModelCandidates)

	return resolveCandidates{
		ModelCandidates:        modelCandidates,
		RelaxedModelCandidates: relaxedModelCandidates,
		ProviderCandidates:     resolveInputProviderCandidates(provider, allModelCandidates, providerHints),
	}
}

func collectRelaxedResolveModelCandidates(modelCandidates []string) []string {
	relaxedModelCandidates := make([]string, 0, len(modelCandidates))
	for _, modelCandidate := range modelCandidates {
		relaxedModelCandidates = mergeResolveCandidates(
			relaxedModelCandidates,
			resolveRelaxedInputModelCandidates(modelCandidate),
		)
	}
	return relaxedModelCandidates
}

func (i resolveIndex) tryResolveMappedAlias(result *ResolveResult, provider string, model string) bool {
	providerCandidates := resolveInputProviderCandidates(provider, nil, nil)
	modelCandidates := []string{model, strings.ToLower(model)}
	matches := i.collectMappedMatches(providerCandidates, modelCandidates)
	if len(matches) == 0 {
		return false
	}
	if len(matches) > 1 {
		result.Reason = ResolveReasonAmbiguous
		return true
	}
	setResolvedResult(result, ResolveMatchStrategyExact, singleResolveCard(matches))
	return true
}

func (i resolveIndex) tryResolveWithCollector(
	result *ResolveResult,
	inputModel string,
	matchStrategy string,
	providerCandidates []string,
	modelCandidates []string,
	collect resolveCollector,
) bool {
	matches := collect(providerCandidates, modelCandidates)
	return applyResolveMatches(result, inputModel, matchStrategy, matches)
}

func applyResolveMatches(result *ResolveResult, inputModel string, matchStrategy string, matches map[string]Card) bool {
	switch len(matches) {
	case 0:
		return false
	case 1:
		setResolvedResult(result, matchStrategy, singleResolveCard(matches))
		return true
	default:
		resolved, ok := disambiguateResolveMatch(matches, inputModel)
		if ok {
			setResolvedResult(result, matchStrategy, resolved)
			return true
		}
		result.Reason = ResolveReasonAmbiguous
		return true
	}
}

func setResolvedResult(result *ResolveResult, matchStrategy string, card Card) {
	result.Status = ResolveStatusResolved
	result.MatchStrategy = matchStrategy
	result.Card = resolveCardOutput(card)
}

func resolveInputProviderCandidates(provider string, modelCandidates []string, modelProviderHints []string) []string {
	seen := make(map[string]struct{}, 8)
	out := make([]string, 0, 8)
	appendProvider := func(value string) {
		value = strings.TrimSpace(strings.ToLower(value))
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}

	inputProvider := strings.TrimSpace(strings.ToLower(provider))
	appendProvider(inputProvider)
	for _, alias := range resolveProviderAliasMap[inputProvider] {
		appendProvider(alias)
	}

	for _, hint := range modelProviderHints {
		appendProvider(hint)
	}

	_, hasVertex := seen["vertex"]
	_, hasBedrock := seen["bedrock"]
	_, hasAWSBedrock := seen["aws-bedrock"]

	if hasVertex {
		appendProvider("google")
	}
	if hasVertex || hasBedrock || hasAWSBedrock {
		for _, modelCandidate := range modelCandidates {
			appendProvider(inferProviderFromModel(modelCandidate))
		}
	}

	return out
}

func resolveInputModelCandidates(model string) ([]string, []string) {
	modelSeen := make(map[string]struct{}, 10)
	models := make([]string, 0, 10)
	appendModel := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := modelSeen[value]; ok {
			return
		}
		modelSeen[value] = struct{}{}
		models = append(models, value)
	}

	providerSeen := make(map[string]struct{}, 6)
	providerHints := make([]string, 0, 6)
	appendProviderHint := func(value string) {
		value = strings.TrimSpace(strings.ToLower(value))
		if value == "" {
			return
		}
		if _, ok := providerSeen[value]; ok {
			return
		}
		providerSeen[value] = struct{}{}
		providerHints = append(providerHints, value)
	}

	appendModel(model)
	appendModel(strings.ToLower(model))

	if sourceProvider := providerFromModelID(model); sourceProvider != "" {
		appendProviderHint(sourceProvider)
	}
	if sourceModelPart := modelPartFromSourceModelID(model); sourceModelPart != "" {
		appendModel(sourceModelPart)
		appendModel(strings.ToLower(sourceModelPart))
	}

	if parsedProvider, parsedModel, ok := parseVertexPublisherModel(model); ok {
		appendProviderHint(parsedProvider)
		appendModel(parsedModel)
		appendModel(strings.ToLower(parsedModel))
	}
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(model)), "models/") {
		appendModel(strings.TrimSpace(model[len("models/"):]))
	}

	if trimmedVertexSuffix := trimVertexModelVersion(model); trimmedVertexSuffix != "" && trimmedVertexSuffix != strings.TrimSpace(model) {
		appendModel(trimmedVertexSuffix)
		appendModel(strings.ToLower(trimmedVertexSuffix))
	}

	if bedrockProvider, bedrockModel, ok := parseBedrockModelID(model); ok {
		appendProviderHint(bedrockProvider)
		appendModel(bedrockModel)
		appendModel(strings.ToLower(bedrockModel))

		bedrockCandidates := []string{bedrockModel}
		if trimmedBedrock := trimBedrockInvocationVersion(bedrockModel); trimmedBedrock != "" && trimmedBedrock != bedrockModel {
			appendModel(trimmedBedrock)
			appendModel(strings.ToLower(trimmedBedrock))
			bedrockCandidates = append(bedrockCandidates, trimmedBedrock)
		}
		if bedrockMajor := trimBedrockInvocationMajorVersion(bedrockModel); bedrockMajor != "" && bedrockMajor != bedrockModel {
			appendModel(bedrockMajor)
			appendModel(strings.ToLower(bedrockMajor))
			bedrockCandidates = append(bedrockCandidates, bedrockMajor)
		}

		for _, bedrockCandidate := range bedrockCandidates {
			for _, variant := range bedrockModelVariantsForProvider(bedrockProvider, bedrockCandidate) {
				appendModel(variant)
				appendModel(strings.ToLower(variant))
			}
		}
	}

	return models, providerHints
}

func resolveRelaxedInputModelCandidates(model string) []string {
	trimmed := strings.TrimSpace(model)
	if trimmed == "" {
		return nil
	}

	seen := make(map[string]struct{}, 8)
	models := make([]string, 0, 8)
	appendModel := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		models = append(models, value)
	}

	if noLatest := trimLatestModelAlias(trimmed); noLatest != "" && noLatest != trimmed {
		appendModel(noLatest)
		appendModel(strings.ToLower(noLatest))
	}
	for _, variant := range anthropicModelVariants(trimmed) {
		appendModel(variant)
		appendModel(strings.ToLower(variant))
	}

	return models
}

func mergeResolveCandidates(candidateSets ...[]string) []string {
	seen := make(map[string]struct{}, 16)
	out := make([]string, 0, 16)
	for _, set := range candidateSets {
		for _, candidate := range set {
			candidate = strings.TrimSpace(candidate)
			if candidate == "" {
				continue
			}
			if _, ok := seen[candidate]; ok {
				continue
			}
			seen[candidate] = struct{}{}
			out = append(out, candidate)
		}
	}
	return out
}

func (i resolveIndex) lookupExact(provider string, alias string) []Card {
	alias = strings.TrimSpace(alias)
	if alias == "" {
		return nil
	}
	providerMap, ok := i.exact[provider]
	if !ok {
		return nil
	}
	cardMap, ok := providerMap[alias]
	if !ok {
		return nil
	}
	return cardSetToSlice(cardMap)
}

func (i resolveIndex) lookupMapped(provider string, alias string) []Card {
	alias = strings.TrimSpace(alias)
	if alias == "" {
		return nil
	}
	providerMap, ok := i.mapped[provider]
	if !ok {
		return nil
	}
	cardMap, ok := providerMap[alias]
	if !ok {
		return nil
	}
	return cardSetToSlice(cardMap)
}

func (i resolveIndex) lookupNormalized(provider string, alias string) []Card {
	if alias == "" {
		return nil
	}
	providerMap, ok := i.normalized[provider]
	if !ok {
		return nil
	}
	cardMap, ok := providerMap[alias]
	if !ok {
		return nil
	}
	return cardSetToSlice(cardMap)
}

func (i resolveIndex) collectMappedMatches(providerCandidates []string, modelCandidates []string) map[string]Card {
	matches := make(map[string]Card)
	for _, providerCandidate := range providerCandidates {
		for _, modelCandidate := range modelCandidates {
			for _, card := range i.lookupMapped(providerCandidate, modelCandidate) {
				matches[card.ModelKey] = card
			}
		}
	}
	return matches
}

func (i resolveIndex) collectExactMatches(providerCandidates []string, modelCandidates []string) map[string]Card {
	matches := make(map[string]Card)
	for _, providerCandidate := range providerCandidates {
		for _, modelCandidate := range modelCandidates {
			for _, card := range i.lookupExact(providerCandidate, modelCandidate) {
				matches[card.ModelKey] = card
			}
		}
	}
	return matches
}

func (i resolveIndex) collectNormalizedMatches(providerCandidates []string, modelCandidates []string) map[string]Card {
	matches := make(map[string]Card)
	for _, providerCandidate := range providerCandidates {
		for _, modelCandidate := range modelCandidates {
			normalizedModel := normalizeResolveAlias(modelCandidate)
			if normalizedModel == "" {
				continue
			}
			for _, card := range i.lookupNormalized(providerCandidate, normalizedModel) {
				matches[card.ModelKey] = card
			}
		}
	}
	return matches
}

func singleResolveCard(matches map[string]Card) Card {
	for _, card := range matches {
		return card
	}
	return Card{}
}

func disambiguateResolveMatch(matches map[string]Card, inputModel string) (Card, bool) {
	trimmedInput := strings.TrimSpace(inputModel)
	if trimmedInput == "" || strings.Contains(trimmedInput, ":") {
		return Card{}, false
	}

	nonColonCards := make([]Card, 0, len(matches))
	for _, card := range matches {
		modelPart := modelPartFromSourceModelID(card.SourceModelID)
		if strings.Contains(modelPart, ":") {
			continue
		}
		nonColonCards = append(nonColonCards, card)
	}
	if len(nonColonCards) != 1 {
		return Card{}, false
	}
	return nonColonCards[0], true
}

func cardSetToSlice(cards map[string]Card) []Card {
	if len(cards) == 0 {
		return nil
	}
	out := make([]Card, 0, len(cards))
	for _, card := range cards {
		out = append(out, card)
	}
	return out
}

func resolveCardOutput(card Card) *ResolvedCard {
	return &ResolvedCard{
		ModelKey:      card.ModelKey,
		SourceModelID: card.SourceModelID,
		Pricing:       card.Pricing,
	}
}

func resolveProviderForCard(card Card) string {
	if provider := strings.ToLower(strings.TrimSpace(card.Provider)); provider != "" {
		return provider
	}
	return strings.ToLower(strings.TrimSpace(providerFromModelID(card.SourceModelID)))
}

func resolveAliasesForCard(card Card) []string {
	seen := map[string]struct{}{}
	aliases := make([]string, 0, 3)
	appendAlias := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, exists := seen[value]; exists {
			return
		}
		seen[value] = struct{}{}
		aliases = append(aliases, value)
	}

	appendAlias(card.SourceModelID)
	appendAlias(card.CanonicalSlug)
	sourceModelPart := modelPartFromSourceModelID(card.SourceModelID)
	canonicalModelPart := modelPartFromSourceModelID(card.CanonicalSlug)
	appendAlias(sourceModelPart)
	if shouldAddCanonicalModelPartAlias(sourceModelPart, canonicalModelPart) {
		appendAlias(canonicalModelPart)
	}
	return aliases
}

func shouldAddCanonicalModelPartAlias(sourceModelPart string, canonicalModelPart string) bool {
	sourceModelPart = strings.ToLower(strings.TrimSpace(sourceModelPart))
	canonicalModelPart = strings.ToLower(strings.TrimSpace(canonicalModelPart))
	if canonicalModelPart == "" {
		return false
	}
	if sourceModelPart == "" {
		return true
	}
	if canonicalModelPart == sourceModelPart {
		return false
	}
	if strings.HasPrefix(canonicalModelPart, sourceModelPart) && len(canonicalModelPart) > len(sourceModelPart) {
		switch canonicalModelPart[len(sourceModelPart)] {
		case '-', ':', '@', '.':
			return true
		}
	}
	if noLatest := trimLatestModelAlias(canonicalModelPart); noLatest != canonicalModelPart {
		return true
	}
	if noDate, ok := trimTrailingDateToken(canonicalModelPart); ok && noDate != canonicalModelPart {
		return true
	}
	return false
}

func modelPartFromSourceModelID(sourceModelID string) string {
	trimmed := strings.TrimSpace(sourceModelID)
	if trimmed == "" {
		return ""
	}
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) != 2 {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func normalizeResolveAlias(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return ""
	}

	var builder strings.Builder
	builder.Grow(len(normalized))
	lastDash := false

	for _, r := range normalized {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
			lastDash = false
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
			lastDash = false
		case r == '/' || r == ':':
			builder.WriteRune(r)
			lastDash = false
		case r == '-' || r == '_' || r == '.' || r == ' ':
			if lastDash {
				continue
			}
			builder.WriteByte('-')
			lastDash = true
		default:
			// Drop unsupported punctuation to keep normalization deterministic.
		}
	}

	return strings.Trim(builder.String(), "-")
}

func parseVertexPublisherModel(model string) (provider string, parsedModel string, ok bool) {
	trimmed := strings.TrimSpace(model)
	if trimmed == "" {
		return "", "", false
	}
	segments := strings.Split(trimmed, "/")
	for i := 0; i+3 < len(segments); i++ {
		if segments[i] != "publishers" || segments[i+2] != "models" {
			continue
		}
		provider = strings.TrimSpace(strings.ToLower(segments[i+1]))
		parsedModel = strings.TrimSpace(strings.Join(segments[i+3:], "/"))
		if provider == "" || parsedModel == "" {
			return "", "", false
		}
		return provider, parsedModel, true
	}
	return "", "", false
}

func trimVertexModelVersion(model string) string {
	trimmed := strings.TrimSpace(model)
	if trimmed == "" {
		return ""
	}
	at := strings.LastIndex(trimmed, "@")
	if at <= 0 || at == len(trimmed)-1 {
		return trimmed
	}
	suffix := trimmed[at+1:]
	for _, r := range suffix {
		isAllowed := (r >= 'a' && r <= 'z') ||
			(r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') ||
			r == '-' || r == '_' || r == '.'
		if !isAllowed {
			return trimmed
		}
	}
	return strings.TrimSpace(trimmed[:at])
}

func parseBedrockModelID(model string) (provider string, parsedModel string, ok bool) {
	trimmed := strings.TrimSpace(strings.ToLower(model))
	if trimmed == "" {
		return "", "", false
	}
	if idx := strings.Index(trimmed, "foundation-model/"); idx >= 0 {
		trimmed = strings.TrimSpace(trimmed[idx+len("foundation-model/"):])
	}

	parts := strings.SplitN(trimmed, ".", 2)
	if len(parts) != 2 {
		return "", "", false
	}

	provider = providerFromBedrockVendor(parts[0])
	parsedModel = strings.TrimSpace(parts[1])
	if provider == "" || parsedModel == "" {
		return "", "", false
	}
	return provider, parsedModel, true
}

func providerFromBedrockVendor(vendor string) string {
	switch strings.TrimSpace(strings.ToLower(vendor)) {
	case "anthropic":
		return "anthropic"
	case "amazon":
		return "amazon"
	case "cohere":
		return "cohere"
	case "meta":
		return "meta-llama"
	case "mistral":
		return "mistralai"
	default:
		return strings.TrimSpace(strings.ToLower(vendor))
	}
}

func trimBedrockInvocationVersion(model string) string {
	trimmed := strings.TrimSpace(model)
	if trimmed == "" {
		return ""
	}
	idx := strings.LastIndex(trimmed, "-v")
	if idx <= 0 || idx+2 >= len(trimmed) {
		return trimmed
	}
	rest := trimmed[idx+2:]
	parts := strings.SplitN(rest, ":", 2)
	if len(parts) != 2 || !allDigits(parts[0]) || !allDigits(parts[1]) {
		return trimmed
	}
	return strings.TrimSpace(trimmed[:idx])
}

func trimBedrockInvocationMajorVersion(model string) string {
	trimmed := strings.TrimSpace(model)
	if trimmed == "" {
		return ""
	}
	idx := strings.LastIndex(trimmed, "-v")
	if idx <= 0 || idx+2 >= len(trimmed) {
		return ""
	}
	rest := trimmed[idx+2:]
	parts := strings.SplitN(rest, ":", 2)
	if len(parts) != 2 || !allDigits(parts[0]) || !allDigits(parts[1]) {
		return ""
	}
	return strings.TrimSpace(trimmed[:idx] + "-v" + parts[0])
}

func bedrockModelVariantsForProvider(provider string, model string) []string {
	provider = strings.TrimSpace(strings.ToLower(provider))
	model = strings.TrimSpace(strings.ToLower(model))
	if provider == "" || model == "" {
		return nil
	}

	switch provider {
	case "meta-llama":
		return metaBedrockModelVariants(model)
	default:
		return nil
	}
}

func metaBedrockModelVariants(model string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, 4)
	appendVariant := func(value string) {
		value = strings.TrimSpace(strings.ToLower(value))
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}

	if strings.HasPrefix(model, "llama") && len(model) > len("llama") {
		next := rune(model[len("llama")])
		if next >= '0' && next <= '9' {
			appendVariant("llama-" + model[len("llama"):])
		}
	}

	base := append([]string(nil), out...)
	for _, value := range base {
		if strings.HasPrefix(value, "llama-4-") {
			if idx := strings.Index(value, "-17b-instruct"); idx > 0 {
				appendVariant(value[:idx])
			}
		}
	}

	return out
}

func trimLatestModelAlias(model string) string {
	trimmed := strings.TrimSpace(model)
	if trimmed == "" {
		return ""
	}
	lower := strings.ToLower(trimmed)
	switch {
	case strings.HasSuffix(lower, "-latest"):
		return strings.TrimSpace(trimmed[:len(trimmed)-len("-latest")])
	case strings.HasSuffix(lower, ":latest"):
		return strings.TrimSpace(trimmed[:len(trimmed)-len(":latest")])
	default:
		return trimmed
	}
}

func anthropicModelVariants(model string) []string {
	normalized := strings.ToLower(strings.TrimSpace(model))
	if normalized == "" || !strings.HasPrefix(normalized, "claude-") {
		return nil
	}

	seen := map[string]struct{}{}
	variants := make([]string, 0, 8)
	queue := []string{normalized}
	for len(queue) > 0 {
		current := strings.TrimSpace(queue[0])
		queue = queue[1:]
		if current == "" {
			continue
		}
		if _, ok := seen[current]; ok {
			continue
		}
		seen[current] = struct{}{}
		variants = append(variants, current)

		if noLatest := trimLatestModelAlias(current); noLatest != "" && noLatest != current {
			queue = append(queue, noLatest)
		}
		if noDate, ok := trimTrailingDateToken(current); ok && noDate != current {
			queue = append(queue, noDate)
		}
		if dotted := normalizeSingleDigitVersionPair(current); dotted != current {
			queue = append(queue, dotted)
		}
		if reordered := reorderClaudeFamilyVersion(current); reordered != "" && reordered != current {
			queue = append(queue, reordered)
		}
	}

	return variants
}

func trimTrailingDateToken(model string) (string, bool) {
	parts := strings.Split(strings.TrimSpace(model), "-")
	if len(parts) < 2 {
		return model, false
	}

	last := parts[len(parts)-1]
	if isEightDigitDateToken(last) {
		return strings.Join(parts[:len(parts)-1], "-"), true
	}
	if len(parts) >= 3 {
		year := parts[len(parts)-3]
		month := parts[len(parts)-2]
		day := parts[len(parts)-1]
		if isYearToken(year) && isMonthToken(month) && isDayToken(day) {
			return strings.Join(parts[:len(parts)-3], "-"), true
		}
	}
	return model, false
}

func isEightDigitDateToken(value string) bool {
	if len(value) != 8 || !allDigits(value) {
		return false
	}
	return strings.HasPrefix(value, "19") || strings.HasPrefix(value, "20")
}

func isYearToken(value string) bool {
	if len(value) != 4 || !allDigits(value) {
		return false
	}
	return strings.HasPrefix(value, "19") || strings.HasPrefix(value, "20")
}

func isMonthToken(value string) bool {
	if !allDigits(value) {
		return false
	}
	if len(value) == 1 {
		return value >= "1" && value <= "9"
	}
	if len(value) != 2 {
		return false
	}
	return value >= "01" && value <= "12"
}

func isDayToken(value string) bool {
	if !allDigits(value) {
		return false
	}
	if len(value) == 1 {
		return value >= "1" && value <= "9"
	}
	if len(value) != 2 {
		return false
	}
	return value >= "01" && value <= "31"
}

func normalizeSingleDigitVersionPair(model string) string {
	parts := strings.Split(strings.TrimSpace(model), "-")
	if len(parts) < 3 {
		return strings.TrimSpace(model)
	}

	out := make([]string, 0, len(parts))
	for i := 0; i < len(parts); {
		if i+1 < len(parts) &&
			len(parts[i]) == 1 &&
			len(parts[i+1]) == 1 &&
			allDigits(parts[i]) &&
			allDigits(parts[i+1]) {
			out = append(out, parts[i]+"."+parts[i+1])
			i += 2
			continue
		}
		out = append(out, parts[i])
		i++
	}
	return strings.Join(out, "-")
}

func reorderClaudeFamilyVersion(model string) string {
	parts := strings.Split(strings.TrimSpace(strings.ToLower(model)), "-")
	if len(parts) < 3 || parts[0] != "claude" {
		return ""
	}

	isFamily := func(value string) bool {
		switch value {
		case "haiku", "sonnet", "opus":
			return true
		default:
			return false
		}
	}

	first := parts[1]
	second := parts[2]
	switch {
	case isFamily(first) && looksLikeClaudeVersionToken(second):
		out := []string{"claude", second, first}
		if len(parts) > 3 {
			out = append(out, parts[3:]...)
		}
		return strings.Join(out, "-")
	case looksLikeClaudeVersionToken(first) && isFamily(second):
		out := []string{"claude", second, first}
		if len(parts) > 3 {
			out = append(out, parts[3:]...)
		}
		return strings.Join(out, "-")
	default:
		return ""
	}
}

func looksLikeClaudeVersionToken(value string) bool {
	if value == "" {
		return false
	}
	parts := strings.Split(value, ".")
	if len(parts) == 0 || len(parts) > 2 {
		return false
	}
	for _, part := range parts {
		if part == "" || !allDigits(part) {
			return false
		}
	}
	return true
}

func allDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func inferProviderFromModel(model string) string {
	normalized := strings.TrimSpace(strings.ToLower(model))
	if normalized == "" {
		return ""
	}

	switch {
	case strings.HasPrefix(normalized, "gemini"), strings.HasPrefix(normalized, "gemma"):
		return "google"
	case strings.HasPrefix(normalized, "claude"):
		return "anthropic"
	case strings.HasPrefix(normalized, "grok"):
		return "x-ai"
	case strings.HasPrefix(normalized, "llama"):
		return "meta-llama"
	case strings.HasPrefix(normalized, "mistral"), strings.HasPrefix(normalized, "mixtral"), strings.HasPrefix(normalized, "ministral"):
		return "mistralai"
	case strings.HasPrefix(normalized, "command"), strings.HasPrefix(normalized, "embed"):
		return "cohere"
	case strings.HasPrefix(normalized, "nova"):
		return "amazon"
	default:
		return ""
	}
}
