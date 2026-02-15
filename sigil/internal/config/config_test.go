package config

import (
	"testing"
)

func TestFromEnvDefaultsTargetToAll(t *testing.T) {
	t.Setenv("SIGIL_TARGET", "")

	cfg := FromEnv()
	if cfg.Target != TargetAll {
		t.Fatalf("expected target %q, got %q", TargetAll, cfg.Target)
	}
}

func TestFromEnvConversationFeedbackFlags(t *testing.T) {
	t.Setenv("SIGIL_CONVERSATION_RATINGS_ENABLED", "")
	t.Setenv("SIGIL_CONVERSATION_ANNOTATIONS_ENABLED", "")

	cfg := FromEnv()
	if !cfg.ConversationRatingsEnabled {
		t.Fatalf("expected conversation ratings to be enabled by default")
	}
	if !cfg.ConversationAnnotationsEnabled {
		t.Fatalf("expected conversation annotations to be enabled by default")
	}

	t.Setenv("SIGIL_CONVERSATION_RATINGS_ENABLED", "false")
	t.Setenv("SIGIL_CONVERSATION_ANNOTATIONS_ENABLED", "off")

	cfg = FromEnv()
	if cfg.ConversationRatingsEnabled {
		t.Fatalf("expected conversation ratings override to be false")
	}
	if cfg.ConversationAnnotationsEnabled {
		t.Fatalf("expected conversation annotations override to be false")
	}
}

func TestFromEnvDefaultsObjectStoreAuth(t *testing.T) {
	t.Setenv("SIGIL_OBJECT_STORE_S3_AWS_SDK_AUTH", "")
	t.Setenv("SIGIL_OBJECT_STORE_ACCESS_KEY", "")
	t.Setenv("SIGIL_OBJECT_STORE_SECRET_KEY", "")
	t.Setenv("SIGIL_OBJECT_STORE_INSECURE", "")

	cfg := FromEnv()
	if cfg.ObjectStore.S3.AccessKey != "minioadmin" {
		t.Fatalf("expected default object store access key, got %q", cfg.ObjectStore.S3.AccessKey)
	}
	if cfg.ObjectStore.S3.SecretKey != "minioadmin" {
		t.Fatalf("expected default object store secret key, got %q", cfg.ObjectStore.S3.SecretKey)
	}
	if !cfg.ObjectStore.S3.Insecure {
		t.Fatalf("expected default object store insecure=true")
	}
}

func TestFromEnvDefaultsObjectStoreAuthForAWSSDKAuth(t *testing.T) {
	t.Setenv("SIGIL_OBJECT_STORE_S3_AWS_SDK_AUTH", "true")
	t.Setenv("SIGIL_OBJECT_STORE_ACCESS_KEY", "")
	t.Setenv("SIGIL_OBJECT_STORE_SECRET_KEY", "")

	cfg := FromEnv()
	if cfg.ObjectStore.S3.AccessKey != "" {
		t.Fatalf("expected empty object store access key when sdk auth is enabled, got %q", cfg.ObjectStore.S3.AccessKey)
	}
	if cfg.ObjectStore.S3.SecretKey != "" {
		t.Fatalf("expected empty object store secret key when sdk auth is enabled, got %q", cfg.ObjectStore.S3.SecretKey)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected sdk auth object store config to validate, got %v", err)
	}
}

func TestValidateRejectsStaticCredentialsWhenAWSSDKAuthEnabled(t *testing.T) {
	cfg := FromEnv()
	cfg.ObjectStore.S3.UseAWSSDKAuth = true
	cfg.ObjectStore.S3.AccessKey = "minioadmin"
	cfg.ObjectStore.S3.SecretKey = "minioadmin"

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error when sdk auth and static credentials are both set")
	}
}

func TestValidateRejectsInvalidTarget(t *testing.T) {
	cfg := FromEnv()
	cfg.Target = "invalid"

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for invalid target")
	}
}

func TestValidateRejectsInvalidCompactorConfig(t *testing.T) {
	cfg := FromEnv()
	cfg.CompactorConfig.BatchSize = 0

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for invalid compactor config")
	}
}

func TestFromEnvCompactorScalingDefaults(t *testing.T) {
	t.Setenv("SIGIL_COMPACTOR_SHARD_COUNT", "")
	t.Setenv("SIGIL_COMPACTOR_SHARD_WINDOW_SECONDS", "")
	t.Setenv("SIGIL_COMPACTOR_WORKERS", "")
	t.Setenv("SIGIL_COMPACTOR_CYCLE_BUDGET", "")
	t.Setenv("SIGIL_COMPACTOR_CLAIM_TTL", "")
	t.Setenv("SIGIL_COMPACTOR_TARGET_BLOCK_BYTES", "")

	cfg := FromEnv()
	if cfg.CompactorConfig.ShardCount != DefaultCompactorShardCount {
		t.Fatalf("expected shard count default 8, got %d", cfg.CompactorConfig.ShardCount)
	}
	if cfg.CompactorConfig.ShardWindowSeconds != DefaultCompactorShardWindowSeconds {
		t.Fatalf("expected shard window default 60, got %d", cfg.CompactorConfig.ShardWindowSeconds)
	}
	if cfg.CompactorConfig.Workers != DefaultCompactorWorkers {
		t.Fatalf("expected workers default 4, got %d", cfg.CompactorConfig.Workers)
	}
	if cfg.CompactorConfig.CycleBudget != DefaultCompactorCycleBudget {
		t.Fatalf("expected cycle budget default 30s, got %s", cfg.CompactorConfig.CycleBudget)
	}
	if cfg.CompactorConfig.ClaimTTL != DefaultCompactorClaimTTL {
		t.Fatalf("expected claim ttl default 5m, got %s", cfg.CompactorConfig.ClaimTTL)
	}
	if cfg.CompactorConfig.TargetBlockBytes != DefaultCompactorTargetBlockBytes {
		t.Fatalf("expected target block bytes default 64MiB, got %d", cfg.CompactorConfig.TargetBlockBytes)
	}
}

func TestFromEnvQueryProxyDefaults(t *testing.T) {
	t.Setenv("SIGIL_QUERY_PROXY_PROMETHEUS_BASE_URL", "")
	t.Setenv("SIGIL_QUERY_PROXY_TEMPO_BASE_URL", "")
	t.Setenv("SIGIL_QUERY_PROXY_TIMEOUT", "")

	cfg := FromEnv()
	if cfg.QueryProxy.PrometheusBaseURL != "http://prometheus:9090" {
		t.Fatalf("expected default prometheus proxy url, got %q", cfg.QueryProxy.PrometheusBaseURL)
	}
	if cfg.QueryProxy.TempoBaseURL != "http://tempo:3200" {
		t.Fatalf("expected default tempo proxy url, got %q", cfg.QueryProxy.TempoBaseURL)
	}
	if cfg.QueryProxy.Timeout != DefaultQueryProxyTimeout {
		t.Fatalf("expected default query proxy timeout %s, got %s", DefaultQueryProxyTimeout, cfg.QueryProxy.Timeout)
	}
}

func TestValidateRejectsInvalidCompactorScalingConfig(t *testing.T) {
	cfg := FromEnv()
	cfg.CompactorConfig.ShardCount = 0
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for shard count")
	}

	cfg = FromEnv()
	cfg.CompactorConfig.Workers = 0
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for workers")
	}

	cfg = FromEnv()
	cfg.CompactorConfig.ClaimTTL = 0
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for claim ttl")
	}
}

func TestValidateRejectsInvalidObjectStoreConfig(t *testing.T) {
	cfg := FromEnv()
	cfg.ObjectStore.Backend = "azure"
	cfg.ObjectStore.Azure.StorageAccountName = ""
	cfg.ObjectStore.Azure.StorageAccountKey = ""
	cfg.ObjectStore.Azure.StorageConnectionString = ""
	cfg.ObjectStore.Azure.ContainerName = ""
	cfg.ObjectStore.Bucket = ""

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for invalid object store config")
	}
}

func TestValidateAcceptsGCSBackend(t *testing.T) {
	cfg := FromEnv()
	cfg.ObjectStore.Backend = "gcs"
	cfg.ObjectStore.Bucket = ""
	cfg.ObjectStore.GCS.Bucket = "sigil-gcs"

	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected gcs object store config to validate, got %v", err)
	}
}

func TestValidateAcceptsKnownTargets(t *testing.T) {
	targets := []string{TargetAll, TargetServer, TargetQuerier, TargetCompactor, TargetCatalogSync}

	for _, target := range targets {
		t.Run(target, func(t *testing.T) {
			cfg := FromEnv()
			cfg.Target = target

			if err := cfg.Validate(); err != nil {
				t.Fatalf("expected target %q to validate, got %v", target, err)
			}
		})
	}
}

func TestValidateRejectsInvalidModelCardsConfig(t *testing.T) {
	cfg := FromEnv()
	cfg.ModelCardsConfig.SyncInterval = 0

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for invalid model cards config")
	}
}

func TestValidateRejectsInvalidQueryProxyConfig(t *testing.T) {
	cfg := FromEnv()
	cfg.QueryProxy.Timeout = 0
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for invalid query proxy timeout")
	}

	cfg = FromEnv()
	cfg.QueryProxy.PrometheusBaseURL = "://bad-url"
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for invalid prometheus query proxy url")
	}

	cfg = FromEnv()
	cfg.QueryProxy.TempoBaseURL = "ftp://tempo:3200"
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for invalid tempo query proxy url scheme")
	}
}

func TestValidateRejectsInvalidModelCardsBootstrapMode(t *testing.T) {
	cfg := FromEnv()
	cfg.ModelCardsConfig.BootstrapMode = "invalid"

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for invalid model cards bootstrap mode")
	}
}
