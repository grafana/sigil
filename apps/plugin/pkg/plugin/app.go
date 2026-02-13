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
	apiURL string
	client *http.Client
}

type appJSONData struct {
	SigilAPIURL string `json:"sigilApiUrl"`
}

const defaultSigilAPIURL = "http://sigil:8080"

func NewApp(_ context.Context, settings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	cfg := appJSONData{SigilAPIURL: defaultSigilAPIURL}
	if len(settings.JSONData) > 0 {
		_ = json.Unmarshal(settings.JSONData, &cfg)
	}
	if cfg.SigilAPIURL == "" {
		cfg.SigilAPIURL = defaultSigilAPIURL
	}

	app := App{
		apiURL: cfg.SigilAPIURL,
		client: &http.Client{Timeout: 10 * time.Second},
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
