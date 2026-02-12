package config

import (
	"os"
	"strings"
)

type Config struct {
	HTTPAddr            string
	OTLPGRPCAddr        string
	OTLPHTTPAddr        string
	AuthEnabled         bool
	FakeTenantID        string
	TempoOTLPEndpoint   string
	StorageBackend      string
	MySQLDSN            string
	ObjectStoreEndpoint string
	ObjectStoreBucket   string
}

func FromEnv() Config {
	return Config{
		HTTPAddr:            getEnv("SIGIL_HTTP_ADDR", ":8080"),
		OTLPGRPCAddr:        getEnv("SIGIL_OTLP_GRPC_ADDR", ":4317"),
		OTLPHTTPAddr:        getEnv("SIGIL_OTLP_HTTP_ADDR", ":4318"),
		AuthEnabled:         getEnvBool("SIGIL_AUTH_ENABLED", true),
		FakeTenantID:        getEnv("SIGIL_FAKE_TENANT_ID", "fake"),
		TempoOTLPEndpoint:   getEnv("SIGIL_TEMPO_OTLP_ENDPOINT", "tempo:4317"),
		StorageBackend:      getEnv("SIGIL_STORAGE_BACKEND", "mysql"),
		MySQLDSN:            getEnv("SIGIL_MYSQL_DSN", "sigil:sigil@tcp(mysql:3306)/sigil?parseTime=true"),
		ObjectStoreEndpoint: getEnv("SIGIL_OBJECT_STORE_ENDPOINT", "http://minio:9000"),
		ObjectStoreBucket:   getEnv("SIGIL_OBJECT_STORE_BUCKET", "sigil"),
	}
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
