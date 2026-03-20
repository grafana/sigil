package sigil

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrock"

	"github.com/grafana/sigil/sigil/internal/config"
	"github.com/grafana/sigil/sigil/internal/modelcards"
	"github.com/grafana/sigil/sigil/internal/storage/mysql"
)

func buildModelCardService(ctx context.Context, cfg config.Config, enableLiveSource bool) (*modelcards.Service, error) {
	snapshot, err := modelcards.LoadEmbeddedSnapshot()
	if err != nil {
		return nil, fmt.Errorf("load embedded model-card snapshot: %w", err)
	}
	supplemental, err := modelcards.LoadEmbeddedSupplemental()
	if err != nil {
		return nil, fmt.Errorf("load embedded supplemental model-card catalog: %w", err)
	}
	if err := modelcards.ValidateSupplementalAgainstSnapshot(*snapshot, supplemental); err != nil {
		return nil, fmt.Errorf("validate supplemental model-card catalog against snapshot: %w", err)
	}

	store, err := mysql.NewModelCardStore(cfg.MySQLDSN)
	if err != nil {
		return nil, fmt.Errorf("open model-card mysql store: %w", err)
	}
	if err := store.AutoMigrate(ctx); err != nil {
		return nil, fmt.Errorf("auto-migrate model cards store: %w", err)
	}

	source, err := buildModelCardSource(ctx, cfg, enableLiveSource)
	if err != nil {
		return nil, err
	}

	svc := modelcards.NewServiceWithSupplemental(store, source, snapshot, supplemental, modelcards.Config{
		SyncInterval:  cfg.ModelCardsConfig.SyncInterval,
		LeaseTTL:      cfg.ModelCardsConfig.LeaseTTL,
		SourceTimeout: cfg.ModelCardsConfig.SourceTimeout,
		StaleSoft:     cfg.ModelCardsConfig.StaleSoft,
		StaleHard:     cfg.ModelCardsConfig.StaleHard,
		BootstrapMode: cfg.ModelCardsConfig.BootstrapMode,
	}, nil)

	return svc, nil
}

func buildModelCardSource(ctx context.Context, cfg config.Config, enableLiveSource bool) (modelcards.Source, error) {
	if !enableLiveSource {
		return modelcards.NewStaticErrorSource(errors.New("live model-cards source disabled")), nil
	}

	primary := modelcards.NewOpenRouterSource(cfg.ModelCardsConfig.SourceTimeout)

	if !cfg.ModelCardsConfig.BedrockEnabled {
		return primary, nil
	}

	bedrockSrc, err := newBedrockSource(ctx, cfg.ModelCardsConfig.BedrockRegion)
	if err != nil {
		slog.Warn("bedrock catalog source disabled: failed to load AWS config", "err", err)
		return primary, nil
	}

	return modelcards.NewCompositeSource(primary, []modelcards.Source{bedrockSrc}, nil), nil
}

func newBedrockSource(ctx context.Context, region string) (*modelcards.BedrockSource, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config for bedrock catalog: %w", err)
	}

	client := bedrock.NewFromConfig(awsCfg)
	return modelcards.NewBedrockSource(client), nil
}
