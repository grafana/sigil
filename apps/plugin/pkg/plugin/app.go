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

type appJSONData struct {
	SigilAPIURL             string       `json:"sigilApiUrl"`
	TenantID                flexString   `json:"tenantId"`
	PrometheusDatasourceUID string       `json:"prometheusDatasourceUID"`
	TempoDatasourceUID      string       `json:"tempoDatasourceUID"`
}

// flexString unmarshals both JSON strings and numbers into a Go string.
// Grafana's plugin config UI may store numeric tenant IDs as JSON numbers
// rather than strings, which would cause a standard string field to fail
// unmarshalling and zero out the entire config struct.
type flexString string

func (f *flexString) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || string(data) == "null" {
		return nil
	}
	if data[0] == '"' {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		*f = flexString(s)
		return nil
	}
	// Accept bare numbers (integer or float) and convert to string.
	var n json.Number
	if err := json.Unmarshal(data, &n); err != nil {
		return err
	}
	*f = flexString(n.String())
	return nil
}

const defaultSigilAPIURL = "http://sigil:8080"
const defaultTenantID = "fake"

const (
	// permissionDataRead grants read-only access to plugin query routes.
	permissionDataRead = "grafana-sigil-app.data:read"
	// permissionFeedbackWrite grants conversation feedback write access.
	permissionFeedbackWrite = "grafana-sigil-app.feedback:write"
	// permissionSettingsWrite grants datasource settings write access.
	permissionSettingsWrite = "grafana-sigil-app.settings:write"
)

type authorizationClient interface {
	HasAccess(ctx context.Context, token string, action string, resources ...authz.Resource) (bool, error)
}

func NewApp(ctx context.Context, settings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	cfg := appJSONData{
		SigilAPIURL: defaultSigilAPIURL,
		TenantID:    flexString(defaultTenantID),
	}
	if len(settings.JSONData) > 0 {
		_ = json.Unmarshal(settings.JSONData, &cfg)
	}
	if cfg.SigilAPIURL == "" {
		cfg.SigilAPIURL = defaultSigilAPIURL
	}
	tenantID := strings.TrimSpace(string(cfg.TenantID))
	if tenantID == "" {
		tenantID = defaultTenantID
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
		tenantID:                   tenantID,
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

// getAuthzClient lazily initializes and caches the Grafana authorization client.
func (a *App) getAuthzClient(ctx context.Context) (authorizationClient, error) {
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
