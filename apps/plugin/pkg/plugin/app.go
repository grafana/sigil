package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
)

var (
	_ backend.CallResourceHandler   = (*App)(nil)
	_ instancemgmt.InstanceDisposer = (*App)(nil)
	_ backend.CheckHealthHandler    = (*App)(nil)
)

type App struct {
	backend.CallResourceHandler
	apiURL   string
	tenantID string
	client   *http.Client
}

type appJSONData struct {
	SigilAPIURL string `json:"sigilApiUrl"`
	TenantID    string `json:"tenantId"`
}

const defaultSigilAPIURL = "http://sigil:8080"
const defaultTenantID = "fake"

func NewApp(_ context.Context, settings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	cfg := appJSONData{
		SigilAPIURL: defaultSigilAPIURL,
		TenantID:    defaultTenantID,
	}
	if len(settings.JSONData) > 0 {
		_ = json.Unmarshal(settings.JSONData, &cfg)
	}
	if cfg.SigilAPIURL == "" {
		cfg.SigilAPIURL = defaultSigilAPIURL
	}
	if cfg.TenantID == "" {
		cfg.TenantID = defaultTenantID
	}

	app := App{
		apiURL:   cfg.SigilAPIURL,
		tenantID: cfg.TenantID,
		client:   &http.Client{Timeout: 10 * time.Second},
	}

	mux := http.NewServeMux()
	app.registerRoutes(mux)
	app.CallResourceHandler = httpadapter.New(mux)

	return &app, nil
}

func (a *App) Dispose() {
	// no-op
}

func (a *App) CheckHealth(_ context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "ok",
	}, nil
}
