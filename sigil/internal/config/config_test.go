package config

import (
	"strings"
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

func TestValidateRejectsUnsupportedStorageBackend(t *testing.T) {
	cfg := FromEnv()
	cfg.StorageBackend = "memory"

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for unsupported storage backend")
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

func TestFromEnvQueryReadDefaults(t *testing.T) {
	t.Setenv("SIGIL_QUERY_COLD_TOTAL_BUDGET", "")
	t.Setenv("SIGIL_QUERY_COLD_INDEX_READ_TIMEOUT", "")
	t.Setenv("SIGIL_QUERY_COLD_INDEX_RETRIES", "")
	t.Setenv("SIGIL_QUERY_COLD_INDEX_WORKERS", "")
	t.Setenv("SIGIL_QUERY_COLD_INDEX_MAX_INFLIGHT", "")
	t.Setenv("SIGIL_QUERY_COLD_INDEX_CACHE_TTL", "")
	t.Setenv("SIGIL_QUERY_COLD_INDEX_CACHE_MAX_BYTES", "")

	cfg := FromEnv()
	if cfg.QueryRead.ColdTotalBudget != DefaultQueryColdTotalBudget {
		t.Fatalf("expected default cold total budget %s, got %s", DefaultQueryColdTotalBudget, cfg.QueryRead.ColdTotalBudget)
	}
	if cfg.QueryRead.ColdIndexReadTimeout != DefaultQueryColdIndexReadTimeout {
		t.Fatalf("expected default cold index read timeout %s, got %s", DefaultQueryColdIndexReadTimeout, cfg.QueryRead.ColdIndexReadTimeout)
	}
	if cfg.QueryRead.ColdIndexRetries != DefaultQueryColdIndexRetries {
		t.Fatalf("expected default cold index retries %d, got %d", DefaultQueryColdIndexRetries, cfg.QueryRead.ColdIndexRetries)
	}
	if cfg.QueryRead.ColdIndexWorkers != DefaultQueryColdIndexWorkers {
		t.Fatalf("expected default cold index workers %d, got %d", DefaultQueryColdIndexWorkers, cfg.QueryRead.ColdIndexWorkers)
	}
	if cfg.QueryRead.ColdIndexMaxInflight != DefaultQueryColdIndexMaxInflight {
		t.Fatalf("expected default cold index max inflight %d, got %d", DefaultQueryColdIndexMaxInflight, cfg.QueryRead.ColdIndexMaxInflight)
	}
	if cfg.QueryRead.ColdIndexCacheTTL != DefaultQueryColdIndexCacheTTL {
		t.Fatalf("expected default cold index cache ttl %s, got %s", DefaultQueryColdIndexCacheTTL, cfg.QueryRead.ColdIndexCacheTTL)
	}
	if cfg.QueryRead.ColdIndexCacheMaxBytes != DefaultQueryColdIndexCacheMaxBytes {
		t.Fatalf("expected default cold index cache max bytes %d, got %d", DefaultQueryColdIndexCacheMaxBytes, cfg.QueryRead.ColdIndexCacheMaxBytes)
	}
}

func TestFromEnvGrafanaTempoDefaults(t *testing.T) {
	t.Setenv("SIGIL_GRAFANA_URL", "")
	t.Setenv("SIGIL_GRAFANA_SA_TOKEN", "")
	t.Setenv("SIGIL_GRAFANA_TEMPO_DATASOURCE_UID", "")

	cfg := FromEnv()
	if cfg.GrafanaURL != "" {
		t.Fatalf("expected empty grafana url by default, got %q", cfg.GrafanaURL)
	}
	if cfg.GrafanaServiceAccountToken != "" {
		t.Fatalf("expected empty grafana token by default")
	}
	if cfg.GrafanaTempoDatasourceUID != "" {
		t.Fatalf("expected empty grafana tempo datasource uid by default, got %q", cfg.GrafanaTempoDatasourceUID)
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
	targets := []string{TargetAll, TargetServer, TargetIngester, TargetQuerier, TargetCompactor, TargetCatalogSync, TargetEvalWorker}

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

func TestFromEnvEvaluationDefaults(t *testing.T) {
	t.Setenv("SIGIL_EVAL_WORKER_ENABLED", "")
	t.Setenv("SIGIL_EVAL_MAX_CONCURRENT", "")
	t.Setenv("SIGIL_EVAL_MAX_RATE", "")
	t.Setenv("SIGIL_EVAL_MAX_ATTEMPTS", "")
	t.Setenv("SIGIL_EVAL_CLAIM_BATCH_SIZE", "")
	t.Setenv("SIGIL_EVAL_POLL_INTERVAL", "")
	t.Setenv("SIGIL_EVAL_DEFAULT_JUDGE_MODEL", "")
	t.Setenv("SIGIL_EVAL_SEED_STRICT", "")

	cfg := FromEnv()
	if cfg.EvalWorkerEnabled {
		t.Fatalf("expected eval worker disabled by default")
	}
	if cfg.EvalMaxConcurrent != DefaultEvalMaxConcurrent {
		t.Fatalf("expected default eval max concurrent %d, got %d", DefaultEvalMaxConcurrent, cfg.EvalMaxConcurrent)
	}
	if cfg.EvalMaxRate != DefaultEvalMaxRate {
		t.Fatalf("expected default eval max rate %d, got %d", DefaultEvalMaxRate, cfg.EvalMaxRate)
	}
	if cfg.EvalMaxAttempts != DefaultEvalMaxAttempts {
		t.Fatalf("expected default eval max attempts %d, got %d", DefaultEvalMaxAttempts, cfg.EvalMaxAttempts)
	}
	if cfg.EvalClaimBatchSize != DefaultEvalClaimBatchSize {
		t.Fatalf("expected default eval claim batch size %d, got %d", DefaultEvalClaimBatchSize, cfg.EvalClaimBatchSize)
	}
	if cfg.EvalPollInterval != DefaultEvalPollInterval {
		t.Fatalf("expected default eval poll interval %s, got %s", DefaultEvalPollInterval, cfg.EvalPollInterval)
	}
	if cfg.EvalDefaultJudgeModel != DefaultEvalDefaultJudgeModel {
		t.Fatalf("expected default eval judge model %q, got %q", DefaultEvalDefaultJudgeModel, cfg.EvalDefaultJudgeModel)
	}
	if cfg.EvalSeedStrict {
		t.Fatalf("expected eval seed strict to default to false")
	}
}

func TestFromEnvEvaluationSeedStrictOverride(t *testing.T) {
	t.Setenv("SIGIL_EVAL_SEED_STRICT", "true")

	cfg := FromEnv()
	if !cfg.EvalSeedStrict {
		t.Fatalf("expected eval seed strict override to be true")
	}
}

func TestValidateRejectsInvalidEvaluationConfig(t *testing.T) {
	cfg := FromEnv()
	cfg.EvalMaxConcurrent = 0
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for eval max concurrent")
	}

	cfg = FromEnv()
	cfg.EvalMaxRate = 0
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for eval max rate")
	}

	cfg = FromEnv()
	cfg.EvalMaxAttempts = 0
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for eval max attempts")
	}
}

func TestValidateRejectsInvalidDefaultJudgeModelFormat(t *testing.T) {
	testCases := []string{
		"gpt-4o-mini",
		"openai/",
		"/gpt-4o-mini",
	}

	for _, value := range testCases {
		t.Run(value, func(t *testing.T) {
			cfg := FromEnv()
			cfg.EvalDefaultJudgeModel = value
			err := cfg.Validate()
			if err == nil {
				t.Fatalf("expected validation error for SIGIL_EVAL_DEFAULT_JUDGE_MODEL=%q", value)
			}
			if !strings.Contains(err.Error(), "provider/model format") {
				t.Fatalf("expected provider/model format error, got %v", err)
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

func TestValidateRejectsInvalidQueryReadConfig(t *testing.T) {
	cfg := FromEnv()
	cfg.QueryRead.ColdTotalBudget = 0
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for cold total budget")
	}

	cfg = FromEnv()
	cfg.QueryRead.ColdIndexReadTimeout = 0
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for cold index read timeout")
	}

	cfg = FromEnv()
	cfg.QueryRead.ColdIndexRetries = -1
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for cold index retries")
	}

	cfg = FromEnv()
	cfg.QueryRead.ColdIndexWorkers = 0
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for cold index workers")
	}

	cfg = FromEnv()
	cfg.QueryRead.ColdIndexMaxInflight = 0
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for cold index max inflight")
	}

	cfg = FromEnv()
	cfg.QueryRead.ColdIndexCacheTTL = 0
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for cold index cache ttl")
	}

	cfg = FromEnv()
	cfg.QueryRead.ColdIndexCacheMaxBytes = 0
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for cold index cache max bytes")
	}
}

func TestValidateRejectsInvalidGrafanaTempoConfig(t *testing.T) {
	cfg := FromEnv()
	cfg.GrafanaURL = "://bad-url"
	cfg.GrafanaServiceAccountToken = "token"
	cfg.GrafanaTempoDatasourceUID = "tempo"
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for invalid grafana url")
	}

	cfg = FromEnv()
	cfg.GrafanaURL = "https://grafana.example.com"
	cfg.GrafanaServiceAccountToken = ""
	cfg.GrafanaTempoDatasourceUID = "tempo"
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for missing grafana token")
	}

	cfg = FromEnv()
	cfg.GrafanaURL = "https://grafana.example.com"
	cfg.GrafanaServiceAccountToken = "token"
	cfg.GrafanaTempoDatasourceUID = ""
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for missing grafana tempo datasource uid")
	}
}

func TestValidateRejectsInvalidModelCardsBootstrapMode(t *testing.T) {
	cfg := FromEnv()
	cfg.ModelCardsConfig.BootstrapMode = "invalid"

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for invalid model cards bootstrap mode")
	}
}
