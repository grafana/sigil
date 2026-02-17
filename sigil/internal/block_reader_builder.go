package sigil

import (
	"context"
	"fmt"

	"github.com/grafana/sigil/sigil/internal/config"
	"github.com/grafana/sigil/sigil/internal/storage"
	"github.com/grafana/sigil/sigil/internal/storage/object"
)

func newObjectBlockReader(ctx context.Context, cfg config.ObjectStoreConfig) (storage.BlockReader, error) {
	blockStore, err := object.NewStoreWithProviderConfig(ctx, object.ProviderConfig{
		Backend: cfg.Backend,
		Bucket:  cfg.Bucket,
		S3: object.S3ProviderConfig{
			Endpoint:      cfg.S3.Endpoint,
			Region:        cfg.S3.Region,
			AccessKey:     cfg.S3.AccessKey,
			SecretKey:     cfg.S3.SecretKey,
			Insecure:      cfg.S3.Insecure,
			UseAWSSDKAuth: cfg.S3.UseAWSSDKAuth,
		},
		GCS: object.GCSProviderConfig{
			Bucket:         cfg.GCS.Bucket,
			ServiceAccount: cfg.GCS.ServiceAccount,
			UseGRPC:        cfg.GCS.UseGRPC,
		},
		Azure: object.AzureProviderConfig{
			ContainerName:           cfg.Azure.ContainerName,
			StorageAccountName:      cfg.Azure.StorageAccountName,
			StorageAccountKey:       cfg.Azure.StorageAccountKey,
			StorageConnectionString: cfg.Azure.StorageConnectionString,
			Endpoint:                cfg.Azure.Endpoint,
			CreateContainer:         cfg.Azure.CreateContainer,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("create object store reader: %w", err)
	}
	return blockStore, nil
}
