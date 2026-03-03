package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/grafana/authlib/authz"
	"github.com/grafana/authlib/cache"
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
	apiURL                     string
	apiAuthToken               string
	tenantID                   string
	prometheusDatasourceUID    string
	tempoDatasourceUID         string
	grafanaAppURL              string
	grafanaServiceAccountToken string
	client                     *http.Client
	authzClient                authorizationClient
	mx                         sync.Mutex
}

type authorizationClient interface {
	HasAccess(ctx context.Context, token string, action string, resources ...authz.Resource) (bool, error)
}

const (
	PermissionDataRead      = "grafana-sigil-app.data:read"
	PermissionFeedbackWrite = "grafana-sigil-app.feedback:write"
	PermissionSettingsWrite = "grafana-sigil-app.settings:write"
)

type appJSONData struct {
	SigilAPIURL             string `json:"sigilApiUrl"`
	TenantID                string `json:"tenantId"`
	PrometheusDatasourceUID string `json:"prometheusDatasourceUID"`
	TempoDatasourceUID      string `json:"tempoDatasourceUID"`
}

const defaultSigilAPIURL = "http://sigil:8080"
const defaultTenantID = "fake"

func NewApp(ctx context.Context, settings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
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

	var grafanaAppURL string
	var grafanaServiceAccountToken string
	grafanaCfg := backend.GrafanaConfigFromContext(ctx)
	if appURL, err := grafanaCfg.AppURL(); err == nil {
		grafanaAppURL = strings.TrimSpace(appURL)
	}
	if serviceAccountToken, err := grafanaCfg.PluginAppClientSecret(); err == nil {
		grafanaServiceAccountToken = strings.TrimSpace(serviceAccountToken)
	}

	var apiAuthToken string
	if settings.DecryptedSecureJSONData != nil {
		apiAuthToken = strings.TrimSpace(settings.DecryptedSecureJSONData["sigilApiAuthToken"])
	}

	app := App{
		apiURL:                     cfg.SigilAPIURL,
		apiAuthToken:               apiAuthToken,
		tenantID:                   cfg.TenantID,
		prometheusDatasourceUID:    strings.TrimSpace(cfg.PrometheusDatasourceUID),
		tempoDatasourceUID:         strings.TrimSpace(cfg.TempoDatasourceUID),
		grafanaAppURL:              strings.TrimSuffix(strings.TrimSpace(grafanaAppURL), "/"),
		grafanaServiceAccountToken: grafanaServiceAccountToken,
		client:                     &http.Client{Timeout: 10 * time.Second},
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

func (a *App) GetAuthZClient(ctx context.Context) (authorizationClient, error) {
	a.mx.Lock()
	defer a.mx.Unlock()

	if a.authzClient != nil {
		return a.authzClient, nil
	}

	apiURL := strings.TrimSpace(a.grafanaAppURL)
	if apiURL == "" {
		grafanaCfg := backend.GrafanaConfigFromContext(ctx)
		if appURL, err := grafanaCfg.AppURL(); err == nil {
			apiURL = strings.TrimSuffix(strings.TrimSpace(appURL), "/")
		}
	}
	if apiURL == "" {
		return nil, errors.New("grafana app URL is unavailable")
	}

	token := strings.TrimSpace(a.grafanaServiceAccountToken)
	if token == "" {
		grafanaCfg := backend.GrafanaConfigFromContext(ctx)
		if serviceAccountToken, err := grafanaCfg.PluginAppClientSecret(); err == nil {
			token = strings.TrimSpace(serviceAccountToken)
		}
	}
	if token == "" {
		return nil, errors.New("grafana service account token is unavailable")
	}

	client, err := authz.NewEnforcementClient(
		authz.Config{
			APIURL:  apiURL,
			Token:   token,
			JWKsURL: strings.TrimRight(apiURL, "/") + "/api/signing-keys/keys",
		},
		authz.WithSearchByPrefix("grafana-sigil-app"),
		authz.WithCache(cache.NewLocalCache(cache.Config{
			Expiry:          10 * time.Second,
			CleanupInterval: 5 * time.Second,
		})),
	)
	if err != nil {
		return nil, fmt.Errorf("create authz client: %w", err)
	}

	a.authzClient = client
	return a.authzClient, nil
}
