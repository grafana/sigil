package tenantauth

import "strings"

const defaultFakeTenantID = "fake"

type Config struct {
	Enabled      bool
	FakeTenantID string
}

func normalizeConfig(cfg Config) Config {
	cfg.FakeTenantID = strings.TrimSpace(cfg.FakeTenantID)
	if cfg.FakeTenantID == "" {
		cfg.FakeTenantID = defaultFakeTenantID
	}
	return cfg
}
