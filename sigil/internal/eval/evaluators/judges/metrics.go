package judges

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
)

type MetricsObserver interface {
	ObserveJudgeRequest(tenantID, provider, model, status string)
	ObserveJudgeDuration(tenantID, provider, model string, duration time.Duration)
	ObserveJudgeTokens(tenantID, provider, model, direction string, count int64)
	ObserveJudgeError(tenantID, provider, model, errorType string)
}

type tenantIDContextKey struct{}

var (
	metricsObserverMu sync.RWMutex
	metricsObserver   MetricsObserver
)

const judgeUnknownLabel = "unknown"

func SetMetricsObserver(observer MetricsObserver) {
	metricsObserverMu.Lock()
	metricsObserver = observer
	metricsObserverMu.Unlock()
}

func WithTenantID(ctx context.Context, tenantID string) context.Context {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if ctx == nil || trimmedTenantID == "" {
		return ctx
	}
	return context.WithValue(ctx, tenantIDContextKey{}, trimmedTenantID)
}

func NewInstrumentedClient(providerID string, client JudgeClient) JudgeClient {
	if client == nil {
		return nil
	}
	return instrumentedClient{
		providerID: strings.TrimSpace(providerID),
		client:     client,
	}
}

type instrumentedClient struct {
	providerID string
	client     JudgeClient
}

func (c instrumentedClient) Judge(ctx context.Context, req JudgeRequest) (JudgeResponse, error) {
	startedAt := time.Now()
	response, err := c.client.Judge(ctx, req)

	observer, tenantID := loadMetricsObserver(ctx)
	if observer == nil || tenantID == "" {
		return response, err
	}

	model := normalizeJudgeLabel(req.Model)
	if responseModel := normalizeJudgeLabel(response.Model); responseModel != judgeUnknownLabel {
		model = responseModel
	}
	providerID := normalizeJudgeLabel(c.providerID)

	status := judgeStatus(ctx, err)
	observer.ObserveJudgeRequest(tenantID, providerID, model, status)
	observer.ObserveJudgeDuration(tenantID, providerID, model, time.Since(startedAt))

	if err != nil {
		observer.ObserveJudgeError(tenantID, providerID, model, classifyJudgeError(ctx, err))
		return response, err
	}

	observer.ObserveJudgeTokens(tenantID, providerID, model, "input", response.Usage.InputTokens)
	observer.ObserveJudgeTokens(tenantID, providerID, model, "output", response.Usage.OutputTokens)
	observer.ObserveJudgeTokens(tenantID, providerID, model, "cache_read", response.Usage.CacheReadTokens)
	return response, err
}

func normalizeJudgeLabel(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return judgeUnknownLabel
	}
	return trimmed
}

func (c instrumentedClient) ListModels(ctx context.Context) ([]JudgeModel, error) {
	return c.client.ListModels(ctx)
}

func loadMetricsObserver(ctx context.Context) (MetricsObserver, string) {
	if ctx == nil {
		return nil, ""
	}
	tenantID, _ := ctx.Value(tenantIDContextKey{}).(string)
	metricsObserverMu.RLock()
	observer := metricsObserver
	metricsObserverMu.RUnlock()
	return observer, strings.TrimSpace(tenantID)
}

func judgeStatus(ctx context.Context, err error) string {
	if err == nil {
		return "success"
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return "timeout"
	}
	return "error"
}

func classifyJudgeError(ctx context.Context, err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return "timeout"
	}

	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "rate limit"), strings.Contains(message, "429"):
		return "rate_limit"
	case strings.Contains(message, "unauthorized"), strings.Contains(message, "forbidden"), strings.Contains(message, "api key"), strings.Contains(message, "auth"):
		return "auth"
	case strings.Contains(message, "5xx"), strings.Contains(message, "server error"), strings.Contains(message, "internal server error"), strings.Contains(message, "503"), strings.Contains(message, "502"):
		return "server_error"
	case strings.Contains(message, "invalid response"), strings.Contains(message, "decode"), strings.Contains(message, "unmarshal"), strings.Contains(message, "parse"):
		return "invalid_response"
	default:
		return judgeUnknownLabel
	}
}
