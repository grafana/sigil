package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	TargetAll         = "all"
	TargetServer      = "server"
	TargetQuerier     = "querier"
	TargetCompactor   = "compactor"
	TargetCatalogSync = "catalog-sync"
)

const (
	DefaultCompactorCompactInterval    = time.Minute
	DefaultCompactorTruncateInterval   = 5 * time.Minute
	DefaultCompactorRetention          = time.Hour
	DefaultCompactorBatchSize          = 1000
	DefaultCompactorLeaseTTL           = 30 * time.Second
	DefaultCompactorShardCount         = 8
	DefaultCompactorShardWindowSeconds = 60
	DefaultCompactorWorkers            = 4
	DefaultCompactorCycleBudget        = 30 * time.Second
	DefaultCompactorClaimTTL           = 5 * time.Minute
	DefaultCompactorTargetBlockBytes   = 64 * 1024 * 1024
)

type Config struct {
	HTTPAddr              string
	OTLPGRPCAddr          string
	OTLPHTTPAddr          string
	Target                string
	AuthEnabled           bool
	FakeTenantID          string
	TempoOTLPGRPCEndpoint string
	TempoOTLPHTTPEndpoint string
	StorageBackend        string
	MySQLDSN              string
	ObjectStore           ObjectStoreConfig
	CompactorConfig       CompactorConfig
	ModelCardsConfig      ModelCardsConfig
}

type ObjectStoreConfig struct {
	Backend string
	Bucket  string
	S3      ObjectStoreS3Config
	GCS     ObjectStoreGCSConfig
	Azure   ObjectStoreAzureConfig
}

type ObjectStoreS3Config struct {
	Endpoint      string
	Region        string
	AccessKey     string
	SecretKey     string
	Insecure      bool
	UseAWSSDKAuth bool
}

type ObjectStoreGCSConfig struct {
	Bucket         string
	ServiceAccount string
	UseGRPC        bool
}

type ObjectStoreAzureConfig struct {
	ContainerName           string
	StorageAccountName      string
	StorageAccountKey       string
	StorageConnectionString string
	Endpoint                string
	CreateContainer         bool
}

type CompactorConfig struct {
	CompactInterval    time.Duration
	TruncateInterval   time.Duration
	Retention          time.Duration
	BatchSize          int
	LeaseTTL           time.Duration
	ShardCount         int
	ShardWindowSeconds int
	Workers            int
	CycleBudget        time.Duration
	ClaimTTL           time.Duration
	TargetBlockBytes   int64
}

type ModelCardsConfig struct {
	SyncInterval  time.Duration
	LeaseTTL      time.Duration
	SourceTimeout time.Duration
	StaleSoft     time.Duration
	StaleHard     time.Duration
	BootstrapMode string
}

func FromEnv() Config {
	useAWSSDKAuth := getEnvBool("SIGIL_OBJECT_STORE_S3_AWS_SDK_AUTH", false)
	defaultAccessKey := "minioadmin"
	defaultSecretKey := "minioadmin"
	if useAWSSDKAuth {
		defaultAccessKey = ""
		defaultSecretKey = ""
	}

	return Config{
		HTTPAddr:              getEnv("SIGIL_HTTP_ADDR", ":8080"),
		OTLPGRPCAddr:          getEnv("SIGIL_OTLP_GRPC_ADDR", ":4317"),
		OTLPHTTPAddr:          getEnv("SIGIL_OTLP_HTTP_ADDR", ":4318"),
		Target:                strings.ToLower(strings.TrimSpace(getEnv("SIGIL_TARGET", TargetAll))),
		AuthEnabled:           getEnvBool("SIGIL_AUTH_ENABLED", true),
		FakeTenantID:          getEnv("SIGIL_FAKE_TENANT_ID", "fake"),
		TempoOTLPGRPCEndpoint: getEnv("SIGIL_TEMPO_OTLP_GRPC_ENDPOINT", "tempo:4317"),
		TempoOTLPHTTPEndpoint: getEnv("SIGIL_TEMPO_OTLP_HTTP_ENDPOINT", "tempo:4318"),
		StorageBackend:        getEnv("SIGIL_STORAGE_BACKEND", "mysql"),
		MySQLDSN:              getEnv("SIGIL_MYSQL_DSN", "sigil:sigil@tcp(mysql:3306)/sigil?parseTime=true"),
		ObjectStore: ObjectStoreConfig{
			Backend: strings.ToLower(strings.TrimSpace(getEnv("SIGIL_OBJECT_STORE_BACKEND", "s3"))),
			Bucket:  getEnv("SIGIL_OBJECT_STORE_BUCKET", "sigil"),
			S3: ObjectStoreS3Config{
				Endpoint:      getEnv("SIGIL_OBJECT_STORE_ENDPOINT", "http://minio:9000"),
				Region:        getEnv("SIGIL_OBJECT_STORE_S3_REGION", ""),
				AccessKey:     getEnv("SIGIL_OBJECT_STORE_ACCESS_KEY", defaultAccessKey),
				SecretKey:     getEnv("SIGIL_OBJECT_STORE_SECRET_KEY", defaultSecretKey),
				Insecure:      getEnvBool("SIGIL_OBJECT_STORE_INSECURE", true),
				UseAWSSDKAuth: useAWSSDKAuth,
			},
			GCS: ObjectStoreGCSConfig{
				Bucket:         getEnv("SIGIL_OBJECT_STORE_GCS_BUCKET", ""),
				ServiceAccount: getEnv("SIGIL_OBJECT_STORE_GCS_SERVICE_ACCOUNT", ""),
				UseGRPC:        getEnvBool("SIGIL_OBJECT_STORE_GCS_USE_GRPC", false),
			},
			Azure: ObjectStoreAzureConfig{
				ContainerName:           getEnv("SIGIL_OBJECT_STORE_AZURE_CONTAINER", ""),
				StorageAccountName:      getEnv("SIGIL_OBJECT_STORE_AZURE_STORAGE_ACCOUNT", ""),
				StorageAccountKey:       getEnv("SIGIL_OBJECT_STORE_AZURE_STORAGE_ACCOUNT_KEY", ""),
				StorageConnectionString: getEnv("SIGIL_OBJECT_STORE_AZURE_STORAGE_CONNECTION_STRING", ""),
				Endpoint:                getEnv("SIGIL_OBJECT_STORE_AZURE_ENDPOINT", "blob.core.windows.net"),
				CreateContainer:         getEnvBool("SIGIL_OBJECT_STORE_AZURE_CREATE_CONTAINER", true),
			},
		},
		CompactorConfig: CompactorConfig{
			CompactInterval:    getEnvDuration("SIGIL_COMPACTOR_COMPACT_INTERVAL", DefaultCompactorCompactInterval),
			TruncateInterval:   getEnvDuration("SIGIL_COMPACTOR_TRUNCATE_INTERVAL", DefaultCompactorTruncateInterval),
			Retention:          getEnvDuration("SIGIL_COMPACTOR_RETENTION", DefaultCompactorRetention),
			BatchSize:          getEnvInt("SIGIL_COMPACTOR_BATCH_SIZE", DefaultCompactorBatchSize),
			LeaseTTL:           getEnvDuration("SIGIL_COMPACTOR_LEASE_TTL", DefaultCompactorLeaseTTL),
			ShardCount:         getEnvInt("SIGIL_COMPACTOR_SHARD_COUNT", DefaultCompactorShardCount),
			ShardWindowSeconds: getEnvInt("SIGIL_COMPACTOR_SHARD_WINDOW_SECONDS", DefaultCompactorShardWindowSeconds),
			Workers:            getEnvInt("SIGIL_COMPACTOR_WORKERS", DefaultCompactorWorkers),
			CycleBudget:        getEnvDuration("SIGIL_COMPACTOR_CYCLE_BUDGET", DefaultCompactorCycleBudget),
			ClaimTTL:           getEnvDuration("SIGIL_COMPACTOR_CLAIM_TTL", DefaultCompactorClaimTTL),
			TargetBlockBytes:   getEnvInt64("SIGIL_COMPACTOR_TARGET_BLOCK_BYTES", DefaultCompactorTargetBlockBytes),
		},
		ModelCardsConfig: ModelCardsConfig{
			SyncInterval:  getEnvDuration("SIGIL_MODEL_CARDS_SYNC_INTERVAL", 30*time.Minute),
			LeaseTTL:      getEnvDuration("SIGIL_MODEL_CARDS_LEASE_TTL", 2*time.Minute),
			SourceTimeout: getEnvDuration("SIGIL_MODEL_CARDS_SOURCE_TIMEOUT", 15*time.Second),
			StaleSoft:     getEnvDuration("SIGIL_MODEL_CARDS_STALE_SOFT", 2*time.Hour),
			StaleHard:     getEnvDuration("SIGIL_MODEL_CARDS_STALE_HARD", 24*time.Hour),
			BootstrapMode: strings.ToLower(strings.TrimSpace(getEnv("SIGIL_MODEL_CARDS_BOOTSTRAP_MODE", "snapshot-first"))),
		},
	}
}

func (c *Config) SetTarget(target string) {
	c.Target = strings.ToLower(strings.TrimSpace(target))
}

func (c Config) Validate() error {
	switch c.Target {
	case TargetAll, TargetServer, TargetQuerier, TargetCompactor, TargetCatalogSync:
	default:
		return fmt.Errorf("invalid target %q", c.Target)
	}

	if c.CompactorConfig.CompactInterval <= 0 {
		return fmt.Errorf("SIGIL_COMPACTOR_COMPACT_INTERVAL must be > 0")
	}
	if c.CompactorConfig.TruncateInterval <= 0 {
		return fmt.Errorf("SIGIL_COMPACTOR_TRUNCATE_INTERVAL must be > 0")
	}
	if c.CompactorConfig.Retention <= 0 {
		return fmt.Errorf("SIGIL_COMPACTOR_RETENTION must be > 0")
	}
	if c.CompactorConfig.BatchSize <= 0 {
		return fmt.Errorf("SIGIL_COMPACTOR_BATCH_SIZE must be > 0")
	}
	if c.CompactorConfig.LeaseTTL <= 0 {
		return fmt.Errorf("SIGIL_COMPACTOR_LEASE_TTL must be > 0")
	}
	if c.CompactorConfig.ShardCount <= 0 {
		return fmt.Errorf("SIGIL_COMPACTOR_SHARD_COUNT must be > 0")
	}
	if c.CompactorConfig.ShardWindowSeconds <= 0 {
		return fmt.Errorf("SIGIL_COMPACTOR_SHARD_WINDOW_SECONDS must be > 0")
	}
	if c.CompactorConfig.Workers <= 0 {
		return fmt.Errorf("SIGIL_COMPACTOR_WORKERS must be > 0")
	}
	if c.CompactorConfig.CycleBudget <= 0 {
		return fmt.Errorf("SIGIL_COMPACTOR_CYCLE_BUDGET must be > 0")
	}
	if c.CompactorConfig.ClaimTTL <= 0 {
		return fmt.Errorf("SIGIL_COMPACTOR_CLAIM_TTL must be > 0")
	}
	if c.CompactorConfig.TargetBlockBytes <= 0 {
		return fmt.Errorf("SIGIL_COMPACTOR_TARGET_BLOCK_BYTES must be > 0")
	}
	if c.ModelCardsConfig.SyncInterval <= 0 {
		return fmt.Errorf("SIGIL_MODEL_CARDS_SYNC_INTERVAL must be > 0")
	}
	if c.ModelCardsConfig.LeaseTTL <= 0 {
		return fmt.Errorf("SIGIL_MODEL_CARDS_LEASE_TTL must be > 0")
	}
	if c.ModelCardsConfig.SourceTimeout <= 0 {
		return fmt.Errorf("SIGIL_MODEL_CARDS_SOURCE_TIMEOUT must be > 0")
	}
	if c.ModelCardsConfig.StaleSoft <= 0 {
		return fmt.Errorf("SIGIL_MODEL_CARDS_STALE_SOFT must be > 0")
	}
	if c.ModelCardsConfig.StaleHard <= 0 {
		return fmt.Errorf("SIGIL_MODEL_CARDS_STALE_HARD must be > 0")
	}
	switch c.ModelCardsConfig.BootstrapMode {
	case "snapshot-first", "db-only":
	default:
		return fmt.Errorf("SIGIL_MODEL_CARDS_BOOTSTRAP_MODE must be one of snapshot-first|db-only")
	}

	if err := c.ObjectStore.Validate(); err != nil {
		return err
	}

	return nil
}

func (c ObjectStoreConfig) Validate() error {
	backend := strings.ToLower(strings.TrimSpace(c.Backend))
	switch backend {
	case "s3":
		if strings.TrimSpace(c.Bucket) == "" {
			return fmt.Errorf("SIGIL_OBJECT_STORE_BUCKET must be set for s3 backend")
		}
		if strings.TrimSpace(c.S3.Endpoint) == "" {
			return fmt.Errorf("SIGIL_OBJECT_STORE_ENDPOINT must be set for s3 backend")
		}
		if c.S3.UseAWSSDKAuth {
			if strings.TrimSpace(c.S3.AccessKey) != "" || strings.TrimSpace(c.S3.SecretKey) != "" {
				return fmt.Errorf("SIGIL_OBJECT_STORE_ACCESS_KEY/SECRET_KEY must be empty when SIGIL_OBJECT_STORE_S3_AWS_SDK_AUTH=true")
			}
		} else {
			if strings.TrimSpace(c.S3.AccessKey) == "" && strings.TrimSpace(c.S3.SecretKey) != "" {
				return fmt.Errorf("SIGIL_OBJECT_STORE_ACCESS_KEY is required when SIGIL_OBJECT_STORE_SECRET_KEY is set")
			}
			if strings.TrimSpace(c.S3.AccessKey) != "" && strings.TrimSpace(c.S3.SecretKey) == "" {
				return fmt.Errorf("SIGIL_OBJECT_STORE_SECRET_KEY is required when SIGIL_OBJECT_STORE_ACCESS_KEY is set")
			}
		}
	case "gcs":
		if strings.TrimSpace(c.GCS.Bucket) == "" && strings.TrimSpace(c.Bucket) == "" {
			return fmt.Errorf("SIGIL_OBJECT_STORE_BUCKET or SIGIL_OBJECT_STORE_GCS_BUCKET must be set for gcs backend")
		}
	case "azure":
		if strings.TrimSpace(c.Azure.ContainerName) == "" && strings.TrimSpace(c.Bucket) == "" {
			return fmt.Errorf("SIGIL_OBJECT_STORE_BUCKET or SIGIL_OBJECT_STORE_AZURE_CONTAINER must be set for azure backend")
		}
		if strings.TrimSpace(c.Azure.StorageAccountName) == "" {
			return fmt.Errorf("SIGIL_OBJECT_STORE_AZURE_STORAGE_ACCOUNT must be set for azure backend")
		}
		if strings.TrimSpace(c.Azure.StorageAccountKey) == "" && strings.TrimSpace(c.Azure.StorageConnectionString) == "" {
			return fmt.Errorf("SIGIL_OBJECT_STORE_AZURE_STORAGE_ACCOUNT_KEY or SIGIL_OBJECT_STORE_AZURE_STORAGE_CONNECTION_STRING must be set for azure backend")
		}
		if strings.TrimSpace(c.Azure.StorageAccountKey) != "" && strings.TrimSpace(c.Azure.StorageConnectionString) != "" {
			return fmt.Errorf("SIGIL_OBJECT_STORE_AZURE_STORAGE_ACCOUNT_KEY and SIGIL_OBJECT_STORE_AZURE_STORAGE_CONNECTION_STRING are mutually exclusive")
		}
	default:
		return fmt.Errorf("invalid object store backend %q", c.Backend)
	}

	return nil
}

func getEnv(key string, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	value, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(value) == "" {
		return defaultValue
	}
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return defaultValue
	}
}

func getEnvDuration(key string, defaultValue time.Duration) time.Duration {
	value, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(value) == "" {
		return defaultValue
	}

	parsed, err := time.ParseDuration(strings.TrimSpace(value))
	if err != nil {
		return 0
	}

	return parsed
}

func getEnvInt(key string, defaultValue int) int {
	value, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(value) == "" {
		return defaultValue
	}

	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0
	}

	return parsed
}

func getEnvInt64(key string, defaultValue int64) int64 {
	value, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(value) == "" {
		return defaultValue
	}

	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return 0
	}

	return parsed
}
