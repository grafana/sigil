package mysql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/grafana/sigil/sigil/internal/modelcards"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ModelCardStore struct {
	db     *gorm.DB
	logger *slog.Logger
}

func NewModelCardStore(dsn string) (*ModelCardStore, error) {
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		NowFunc: func() time.Time {
			return time.Now().UTC()
		},
	})
	if err != nil {
		return nil, err
	}
	return &ModelCardStore{db: db, logger: slog.Default()}, nil
}

func (s *ModelCardStore) AutoMigrate(ctx context.Context) error {
	if err := s.db.WithContext(ctx).AutoMigrate(
		&ModelCardModel{},
		&ModelCardAliasModel{},
		&ModelCardRefreshRunModel{},
		&ModelCardRefreshLeaseModel{},
	); err != nil {
		return fmt.Errorf("auto-migrate model cards tables: %w", err)
	}
	return nil
}

func (s *ModelCardStore) UpsertCards(ctx context.Context, source string, refreshedAt time.Time, cards []modelcards.Card) (int, error) {
	if len(cards) == 0 {
		return 0, nil
	}

	rows := make([]ModelCardModel, 0, len(cards))
	for _, card := range cards {
		rows = append(rows, toModelCardModel(card, source, refreshedAt))
	}

	tx := s.db.WithContext(ctx)
	for _, row := range rows {
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "model_key"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"source",
				"source_model_id",
				"canonical_slug",
				"name",
				"provider",
				"description",
				"context_length",
				"modality",
				"input_modalities_json",
				"output_modalities_json",
				"supported_parameters_json",
				"tokenizer",
				"prompt_price_usd_per_token",
				"completion_price_usd_per_token",
				"request_price_usd",
				"image_price_usd",
				"web_search_price_usd",
				"input_cache_read_price_usd_per_token",
				"input_cache_write_price_usd_per_token",
				"is_free",
				"top_provider_json",
				"expires_at",
				"last_seen_at",
				"deprecated_at",
				"raw_payload_json",
				"refreshed_at",
				"updated_at",
			}),
		}).Create(&row).Error; err != nil {
			return 0, fmt.Errorf("upsert model card %q: %w", row.ModelKey, err)
		}
	}

	return len(rows), nil
}

func (s *ModelCardStore) ListCards(ctx context.Context, params modelcards.ListParams) ([]modelcards.Card, bool, error) {
	if params.Limit <= 0 {
		params.Limit = 50
	}

	query := s.db.WithContext(ctx).Model(&ModelCardModel{})
	query = applyModelCardFilters(query, params)

	orderColumn := sortColumn(params.Sort)
	orderDirection := sortDirection(params.Order)
	query = query.Order(fmt.Sprintf("%s %s", orderColumn, orderDirection)).Order("id ASC")

	var rows []ModelCardModel
	if err := query.Offset(params.Offset).Limit(params.Limit + 1).Find(&rows).Error; err != nil {
		return nil, false, fmt.Errorf("list model cards: %w", err)
	}

	hasMore := false
	if len(rows) > params.Limit {
		hasMore = true
		rows = rows[:params.Limit]
	}

	cards := make([]modelcards.Card, 0, len(rows))
	for _, row := range rows {
		card, err := fromModelCardModel(row)
		if err != nil {
			return nil, false, fmt.Errorf("decode model card row %q: %w", row.ModelKey, err)
		}
		cards = append(cards, card)
	}

	return cards, hasMore, nil
}

func (s *ModelCardStore) GetCardByModelKey(ctx context.Context, modelKey string) (*modelcards.Card, error) {
	var row ModelCardModel
	err := s.db.WithContext(ctx).Where("model_key = ?", modelKey).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, modelcards.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get model card by key: %w", err)
	}
	card, err := fromModelCardModel(row)
	if err != nil {
		return nil, err
	}
	return &card, nil
}

func (s *ModelCardStore) GetCardBySourceID(ctx context.Context, source string, sourceModelID string) (*modelcards.Card, error) {
	var row ModelCardModel
	err := s.db.WithContext(ctx).
		Where("source = ? AND source_model_id = ?", source, sourceModelID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, modelcards.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get model card by source id: %w", err)
	}
	card, err := fromModelCardModel(row)
	if err != nil {
		return nil, err
	}
	return &card, nil
}

func (s *ModelCardStore) CountCards(ctx context.Context) (int64, error) {
	var count int64
	if err := s.db.WithContext(ctx).Model(&ModelCardModel{}).Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count model cards: %w", err)
	}
	return count, nil
}

func (s *ModelCardStore) LatestRefreshedAt(ctx context.Context) (*time.Time, error) {
	var row ModelCardModel
	err := s.db.WithContext(ctx).
		Select("refreshed_at").
		Order("refreshed_at DESC").
		Limit(1).
		Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("latest refreshed_at: %w", err)
	}
	value := row.RefreshedAt.UTC()
	return &value, nil
}

func (s *ModelCardStore) RecordRefreshRun(ctx context.Context, run modelcards.RefreshRun) error {
	detailsJSON := run.DetailsJSON
	if strings.TrimSpace(detailsJSON) == "" {
		detailsJSON = "{}"
	}
	row := ModelCardRefreshRunModel{
		Source:           run.Source,
		RunMode:          run.RunMode,
		Status:           run.Status,
		StartedAt:        run.StartedAt.UTC(),
		FinishedAt:       run.FinishedAt.UTC(),
		FetchedCount:     run.FetchedCount,
		UpsertedCount:    run.UpsertedCount,
		StaleMarkedCount: run.StaleMarkedCount,
		DetailsJSON:      detailsJSON,
	}
	if strings.TrimSpace(run.ErrorSummary) != "" {
		errSummary := run.ErrorSummary
		row.ErrorSummary = &errSummary
	}
	if err := s.db.WithContext(ctx).Create(&row).Error; err != nil {
		return fmt.Errorf("record refresh run: %w", err)
	}
	return nil
}

func (s *ModelCardStore) LatestRefreshRun(ctx context.Context, source string) (*modelcards.RefreshRun, error) {
	var row ModelCardRefreshRunModel
	err := s.db.WithContext(ctx).
		Where("source = ?", source).
		Order("started_at DESC").
		Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, modelcards.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("latest refresh run: %w", err)
	}
	run := modelcards.RefreshRun{
		Source:           row.Source,
		RunMode:          row.RunMode,
		Status:           row.Status,
		StartedAt:        row.StartedAt.UTC(),
		FinishedAt:       row.FinishedAt.UTC(),
		FetchedCount:     row.FetchedCount,
		UpsertedCount:    row.UpsertedCount,
		StaleMarkedCount: row.StaleMarkedCount,
		DetailsJSON:      row.DetailsJSON,
	}
	if row.ErrorSummary != nil {
		run.ErrorSummary = *row.ErrorSummary
	}
	return &run, nil
}

func (s *ModelCardStore) TryAcquireLease(ctx context.Context, scopeKey string, ownerID string, now time.Time, ttl time.Duration) (bool, error) {
	var acquired bool
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		seed := ModelCardRefreshLeaseModel{
			ScopeKey:  scopeKey,
			OwnerID:   ownerID,
			LeasedAt:  now.UTC(),
			ExpiresAt: now.UTC(),
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&seed).Error; err != nil {
			return err
		}

		var lease ModelCardRefreshLeaseModel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("scope_key = ?", scopeKey).
			Take(&lease).Error; err != nil {
			return err
		}

		nowUTC := now.UTC()
		if lease.OwnerID != ownerID && lease.ExpiresAt.After(nowUTC) {
			acquired = false
			return nil
		}

		lease.OwnerID = ownerID
		lease.LeasedAt = nowUTC
		lease.ExpiresAt = nowUTC.Add(ttl)
		if err := tx.Save(&lease).Error; err != nil {
			return err
		}
		acquired = true
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("try acquire lease: %w", err)
	}
	return acquired, nil
}

func (s *ModelCardStore) RenewLease(ctx context.Context, scopeKey string, ownerID string, now time.Time, ttl time.Duration) (bool, error) {
	result := s.db.WithContext(ctx).
		Model(&ModelCardRefreshLeaseModel{}).
		Where("scope_key = ? AND owner_id = ?", scopeKey, ownerID).
		Updates(map[string]any{
			"leased_at":  now.UTC(),
			"expires_at": now.UTC().Add(ttl),
		})
	if result.Error != nil {
		return false, fmt.Errorf("renew lease: %w", result.Error)
	}
	return result.RowsAffected > 0, nil
}

func (s *ModelCardStore) ReleaseLease(ctx context.Context, scopeKey string, ownerID string) error {
	if err := s.db.WithContext(ctx).
		Where("scope_key = ? AND owner_id = ?", scopeKey, ownerID).
		Delete(&ModelCardRefreshLeaseModel{}).Error; err != nil {
		return fmt.Errorf("release lease: %w", err)
	}
	return nil
}

func applyModelCardFilters(query *gorm.DB, params modelcards.ListParams) *gorm.DB {
	if value := strings.TrimSpace(params.Q); value != "" {
		like := "%" + strings.ToLower(value) + "%"
		query = query.Where(
			"LOWER(name) LIKE ? OR LOWER(provider) LIKE ? OR LOWER(source_model_id) LIKE ?",
			like, like, like,
		)
	}
	if value := strings.TrimSpace(params.Source); value != "" {
		query = query.Where("source = ?", value)
	}
	if value := strings.TrimSpace(params.Provider); value != "" {
		query = query.Where("provider = ?", value)
	}
	if params.FreeOnly != nil && *params.FreeOnly {
		query = query.Where("is_free = ?", true)
	}
	if params.MinContextLength != nil {
		query = query.Where("context_length >= ?", *params.MinContextLength)
	}
	if params.MaxPromptPriceUSDPerToken != nil {
		query = query.Where("prompt_price_usd_per_token <= ?", *params.MaxPromptPriceUSDPerToken)
	}
	if params.MaxCompletionPriceUSDPerToken != nil {
		query = query.Where("completion_price_usd_per_token <= ?", *params.MaxCompletionPriceUSDPerToken)
	}
	return query
}

func sortColumn(sortBy string) string {
	switch strings.ToLower(strings.TrimSpace(sortBy)) {
	case "provider":
		return "provider"
	case "prompt_price":
		return "prompt_price_usd_per_token"
	case "context_length":
		return "context_length"
	case "last_seen_at":
		return "last_seen_at"
	default:
		return "name"
	}
}

func sortDirection(order string) string {
	if strings.EqualFold(strings.TrimSpace(order), "desc") {
		return "DESC"
	}
	return "ASC"
}

func toModelCardModel(card modelcards.Card, source string, refreshedAt time.Time) ModelCardModel {
	cardSource := strings.TrimSpace(card.Source)
	if cardSource == "" {
		cardSource = strings.TrimSpace(source)
	}

	inputModalitiesJSON := marshalJSONOrDefault(card.InputModalities, "[]")
	outputModalitiesJSON := marshalJSONOrDefault(card.OutputModalities, "[]")
	supportedParamsJSON := marshalJSONOrDefault(card.SupportedParameters, "[]")
	topProviderJSON := marshalJSONOrDefault(card.TopProvider, "{}")
	rawPayloadJSON := card.RawPayloadJSON
	if strings.TrimSpace(rawPayloadJSON) == "" {
		rawPayloadJSON = "{}"
	}

	firstSeen := card.FirstSeenAt
	if firstSeen.IsZero() {
		firstSeen = refreshedAt.UTC()
	}
	lastSeen := card.LastSeenAt
	if lastSeen.IsZero() {
		lastSeen = refreshedAt.UTC()
	}

	return ModelCardModel{
		ModelKey:                        card.ModelKey,
		Source:                          cardSource,
		SourceModelID:                   card.SourceModelID,
		CanonicalSlug:                   nullableString(card.CanonicalSlug),
		Name:                            card.Name,
		Provider:                        nullableString(card.Provider),
		Description:                     nullableString(card.Description),
		ContextLength:                   card.ContextLength,
		Modality:                        nullableString(card.Modality),
		InputModalitiesJSON:             inputModalitiesJSON,
		OutputModalitiesJSON:            outputModalitiesJSON,
		SupportedParametersJSON:         supportedParamsJSON,
		Tokenizer:                       nullableString(card.Tokenizer),
		PromptPriceUSDPerToken:          card.Pricing.PromptUSDPerToken,
		CompletionPriceUSDPerToken:      card.Pricing.CompletionUSDPerToken,
		RequestPriceUSD:                 card.Pricing.RequestUSD,
		ImagePriceUSD:                   card.Pricing.ImageUSD,
		WebSearchPriceUSD:               card.Pricing.WebSearchUSD,
		InputCacheReadPriceUSDPerToken:  card.Pricing.InputCacheReadUSDPerToken,
		InputCacheWritePriceUSDPerToken: card.Pricing.InputCacheWriteUSDPerToken,
		IsFree:                          card.IsFree,
		TopProviderJSON:                 topProviderJSON,
		ExpiresAt:                       card.ExpiresAt,
		FirstSeenAt:                     firstSeen.UTC(),
		LastSeenAt:                      lastSeen.UTC(),
		RawPayloadJSON:                  rawPayloadJSON,
		RefreshedAt:                     refreshedAt.UTC(),
	}
}

func fromModelCardModel(row ModelCardModel) (modelcards.Card, error) {
	inputModalities := make([]string, 0)
	outputModalities := make([]string, 0)
	supportedParams := make([]string, 0)
	if err := unmarshalJSONOrDefault(row.InputModalitiesJSON, &inputModalities); err != nil {
		return modelcards.Card{}, err
	}
	if err := unmarshalJSONOrDefault(row.OutputModalitiesJSON, &outputModalities); err != nil {
		return modelcards.Card{}, err
	}
	if err := unmarshalJSONOrDefault(row.SupportedParametersJSON, &supportedParams); err != nil {
		return modelcards.Card{}, err
	}

	var topProvider modelcards.TopProvider
	if err := unmarshalJSONOrDefault(row.TopProviderJSON, &topProvider); err != nil {
		return modelcards.Card{}, err
	}

	card := modelcards.Card{
		ModelKey:            row.ModelKey,
		Source:              row.Source,
		SourceModelID:       row.SourceModelID,
		CanonicalSlug:       derefString(row.CanonicalSlug),
		Name:                row.Name,
		Provider:            derefString(row.Provider),
		Description:         derefString(row.Description),
		ContextLength:       row.ContextLength,
		Modality:            derefString(row.Modality),
		InputModalities:     inputModalities,
		OutputModalities:    outputModalities,
		SupportedParameters: supportedParams,
		Tokenizer:           derefString(row.Tokenizer),
		Pricing: modelcards.Pricing{
			PromptUSDPerToken:          row.PromptPriceUSDPerToken,
			CompletionUSDPerToken:      row.CompletionPriceUSDPerToken,
			RequestUSD:                 row.RequestPriceUSD,
			ImageUSD:                   row.ImagePriceUSD,
			WebSearchUSD:               row.WebSearchPriceUSD,
			InputCacheReadUSDPerToken:  row.InputCacheReadPriceUSDPerToken,
			InputCacheWriteUSDPerToken: row.InputCacheWritePriceUSDPerToken,
		},
		IsFree:         row.IsFree,
		TopProvider:    topProvider,
		ExpiresAt:      row.ExpiresAt,
		FirstSeenAt:    row.FirstSeenAt.UTC(),
		LastSeenAt:     row.LastSeenAt.UTC(),
		RefreshedAt:    row.RefreshedAt.UTC(),
		RawPayloadJSON: row.RawPayloadJSON,
	}
	return card, nil
}

func marshalJSONOrDefault(value any, fallback string) string {
	data, err := json.Marshal(value)
	if err != nil {
		return fallback
	}
	return string(data)
}

func unmarshalJSONOrDefault(content string, target any) error {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	if err := json.Unmarshal([]byte(content), target); err != nil {
		return err
	}
	return nil
}

func nullableString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
