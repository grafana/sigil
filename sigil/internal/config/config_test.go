package config

import "testing"

func TestFromEnvDefaultsTargetToAll(t *testing.T) {
	t.Setenv("SIGIL_TARGET", "")

	cfg := FromEnv()
	if cfg.Target != TargetAll {
		t.Fatalf("expected target %q, got %q", TargetAll, cfg.Target)
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

func TestValidateAcceptsKnownTargets(t *testing.T) {
	targets := []string{TargetAll, TargetServer, TargetQuerier, TargetCompactor}

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

func TestFromEnvTempoEndpointDefaults(t *testing.T) {
	t.Setenv("SIGIL_TEMPO_OTLP_GRPC_ENDPOINT", "")
	t.Setenv("SIGIL_TEMPO_OTLP_HTTP_ENDPOINT", "")
	t.Setenv("SIGIL_TEMPO_OTLP_ENDPOINT", "legacy:9999")

	cfg := FromEnv()
	if cfg.TempoOTLPGRPCEndpoint != "tempo:4317" {
		t.Fatalf("expected default grpc endpoint tempo:4317, got %q", cfg.TempoOTLPGRPCEndpoint)
	}
	if cfg.TempoOTLPHTTPEndpoint != "tempo:4318" {
		t.Fatalf("expected default http endpoint tempo:4318, got %q", cfg.TempoOTLPHTTPEndpoint)
	}
}

func TestFromEnvTempoEndpointsOverride(t *testing.T) {
	t.Setenv("SIGIL_TEMPO_OTLP_GRPC_ENDPOINT", "tempo-grpc:14317")
	t.Setenv("SIGIL_TEMPO_OTLP_HTTP_ENDPOINT", "http://tempo-http:14318/v1/traces")

	cfg := FromEnv()
	if cfg.TempoOTLPGRPCEndpoint != "tempo-grpc:14317" {
		t.Fatalf("expected grpc endpoint override, got %q", cfg.TempoOTLPGRPCEndpoint)
	}
	if cfg.TempoOTLPHTTPEndpoint != "http://tempo-http:14318/v1/traces" {
		t.Fatalf("expected http endpoint override, got %q", cfg.TempoOTLPHTTPEndpoint)
	}
}
