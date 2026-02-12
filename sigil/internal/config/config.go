package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	TargetAll       = "all"
	TargetServer    = "server"
	TargetQuerier   = "querier"
	TargetCompactor = "compactor"
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
	ObjectStoreEndpoint   string
	ObjectStoreBucket     string
	CompactorConfig       CompactorConfig
}

type CompactorConfig struct {
	CompactInterval  time.Duration
	TruncateInterval time.Duration
	Retention        time.Duration
	BatchSize        int
	LeaseTTL         time.Duration
}

func FromEnv() Config {
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
		ObjectStoreEndpoint:   getEnv("SIGIL_OBJECT_STORE_ENDPOINT", "http://minio:9000"),
		ObjectStoreBucket:     getEnv("SIGIL_OBJECT_STORE_BUCKET", "sigil"),
		CompactorConfig: CompactorConfig{
			CompactInterval:  getEnvDuration("SIGIL_COMPACTOR_COMPACT_INTERVAL", time.Minute),
			TruncateInterval: getEnvDuration("SIGIL_COMPACTOR_TRUNCATE_INTERVAL", 5*time.Minute),
			Retention:        getEnvDuration("SIGIL_COMPACTOR_RETENTION", time.Hour),
			BatchSize:        getEnvInt("SIGIL_COMPACTOR_BATCH_SIZE", 1000),
			LeaseTTL:         getEnvDuration("SIGIL_COMPACTOR_LEASE_TTL", 30*time.Second),
		},
	}
}

func (c *Config) SetTarget(target string) {
	c.Target = strings.ToLower(strings.TrimSpace(target))
}

func (c Config) Validate() error {
	switch c.Target {
	case TargetAll, TargetServer, TargetQuerier, TargetCompactor:
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
