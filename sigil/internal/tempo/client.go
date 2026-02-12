package tempo

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	collecttracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const (
	transportHTTP = "http"
	transportGRPC = "grpc"

	forwardStatusSuccess       = "success"
	forwardStatusUpstreamError = "upstream_error"
	forwardStatusError         = "error"
)

var (
	tempoForwardRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_tempo_forward_requests_total",
		Help: "Total number of trace forward requests to Tempo partitioned by transport and status.",
	}, []string{"transport", "status"})
	tempoForwardDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sigil_tempo_forward_duration_seconds",
		Help:    "Tempo forward request latency in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"transport"})
	tempoForwardPayloadBytesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sigil_tempo_forward_payload_bytes_total",
		Help: "Total payload bytes attempted for Tempo forwarding by transport.",
	}, []string{"transport"})
)

type Client struct {
	grpcEndpoint string
	httpEndpoint string
	httpClient   *http.Client
	logger       *slog.Logger

	mu         sync.Mutex
	grpcConn   *grpc.ClientConn
	grpcClient collecttracev1.TraceServiceClient
}

type HTTPForwardResponse struct {
	StatusCode int
	Headers    http.Header
	Body       []byte
}

func NewClient(grpcEndpoint string, httpEndpoint string) *Client {
	return &Client{
		grpcEndpoint: grpcEndpoint,
		httpEndpoint: httpEndpoint,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		logger: slog.Default(),
	}
}

func (c *Client) ForwardTraceHTTP(ctx context.Context, payload []byte, headers http.Header) (*HTTPForwardResponse, error) {
	start := time.Now()
	endpoint, err := normalizeHTTPEndpoint(c.httpEndpoint)
	if err != nil {
		observeForward(transportHTTP, forwardStatusError, start, len(payload))
		c.logger.Error("tempo forward failed", "transport", transportHTTP, "endpoint", c.httpEndpoint, "err", err)
		return nil, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		observeForward(transportHTTP, forwardStatusError, start, len(payload))
		c.logger.Error("tempo forward failed", "transport", transportHTTP, "endpoint", endpoint, "err", err)
		return nil, err
	}
	for key, values := range headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		observeForward(transportHTTP, forwardStatusError, start, len(payload))
		c.logger.Error("tempo forward failed", "transport", transportHTTP, "endpoint", endpoint, "err", err)
		return nil, err
	}
	defer func() {
		_ = response.Body.Close()
	}()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		observeForward(transportHTTP, forwardStatusError, start, len(payload))
		c.logger.Error("tempo forward failed", "transport", transportHTTP, "endpoint", endpoint, "err", err)
		return nil, err
	}

	statusLabel := forwardStatusSuccess
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		statusLabel = forwardStatusUpstreamError
	}
	observeForward(transportHTTP, statusLabel, start, len(payload))

	return &HTTPForwardResponse{
		StatusCode: response.StatusCode,
		Headers:    response.Header.Clone(),
		Body:       body,
	}, nil
}

func (c *Client) ForwardTraceGRPC(ctx context.Context, request *collecttracev1.ExportTraceServiceRequest) (*collecttracev1.ExportTraceServiceResponse, error) {
	start := time.Now()
	payloadSize := proto.Size(request)

	client, target, err := c.grpcTraceClient()
	if err != nil {
		observeForward(transportGRPC, forwardStatusError, start, payloadSize)
		c.logger.Error("tempo forward failed", "transport", transportGRPC, "endpoint", c.grpcEndpoint, "err", err)
		return nil, err
	}

	response, err := client.Export(withMergedMetadata(ctx), request)
	if err != nil {
		statusLabel := forwardStatusError
		if _, ok := status.FromError(err); ok {
			statusLabel = forwardStatusUpstreamError
		}
		observeForward(transportGRPC, statusLabel, start, payloadSize)
		c.logger.Error("tempo forward failed", "transport", transportGRPC, "endpoint", target, "err", err)
		return nil, err
	}

	observeForward(transportGRPC, forwardStatusSuccess, start, payloadSize)
	return response, nil
}

func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.grpcConn == nil {
		return nil
	}

	err := c.grpcConn.Close()
	c.grpcConn = nil
	c.grpcClient = nil
	return err
}

func (c *Client) grpcTraceClient() (collecttracev1.TraceServiceClient, string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.grpcClient != nil {
		target, _, err := normalizeGRPCEndpoint(c.grpcEndpoint)
		return c.grpcClient, target, err
	}

	target, useInsecure, err := normalizeGRPCEndpoint(c.grpcEndpoint)
	if err != nil {
		return nil, "", err
	}

	transportCreds := credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12})
	if useInsecure {
		transportCreds = insecure.NewCredentials()
	}

	conn, err := grpc.NewClient(target, grpc.WithTransportCredentials(transportCreds))
	if err != nil {
		return nil, target, fmt.Errorf("dial tempo grpc endpoint %q: %w", target, err)
	}

	c.grpcConn = conn
	c.grpcClient = collecttracev1.NewTraceServiceClient(conn)
	return c.grpcClient, target, nil
}

func observeForward(transport string, status string, start time.Time, payloadSize int) {
	tempoForwardRequestsTotal.WithLabelValues(transport, status).Inc()
	tempoForwardDuration.WithLabelValues(transport).Observe(time.Since(start).Seconds())
	if payloadSize > 0 {
		tempoForwardPayloadBytesTotal.WithLabelValues(transport).Add(float64(payloadSize))
	}
}

func normalizeHTTPEndpoint(endpoint string) (string, error) {
	trimmed := strings.TrimSpace(endpoint)
	if trimmed == "" {
		return "", fmt.Errorf("tempo otlp http endpoint is required")
	}

	rawURL := trimmed
	if !strings.Contains(rawURL, "://") {
		rawURL = "http://" + rawURL
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("parse tempo otlp http endpoint %q: %w", endpoint, err)
	}
	if strings.TrimSpace(parsed.Host) == "" {
		return "", fmt.Errorf("tempo otlp http endpoint %q has empty host", endpoint)
	}
	if parsed.Path == "" || parsed.Path == "/" {
		parsed.Path = "/v1/traces"
	}

	return parsed.String(), nil
}

func normalizeGRPCEndpoint(endpoint string) (string, bool, error) {
	trimmed := strings.TrimSpace(endpoint)
	if trimmed == "" {
		return "", false, fmt.Errorf("tempo otlp grpc endpoint is required")
	}

	if !strings.Contains(trimmed, "://") {
		return trimmed, true, nil
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", false, fmt.Errorf("parse tempo otlp grpc endpoint %q: %w", endpoint, err)
	}
	if strings.TrimSpace(parsed.Host) == "" {
		return "", false, fmt.Errorf("tempo otlp grpc endpoint %q has empty host", endpoint)
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", false, fmt.Errorf("tempo otlp grpc endpoint %q must not contain a path", endpoint)
	}

	switch strings.ToLower(strings.TrimSpace(parsed.Scheme)) {
	case "http", "grpc":
		return parsed.Host, true, nil
	case "https", "grpcs":
		return parsed.Host, false, nil
	default:
		return "", false, fmt.Errorf("tempo otlp grpc endpoint %q has unsupported scheme %q", endpoint, parsed.Scheme)
	}
}

func withMergedMetadata(ctx context.Context) context.Context {
	incoming, hasIncoming := metadata.FromIncomingContext(ctx)
	outgoing, hasOutgoing := metadata.FromOutgoingContext(ctx)
	if !hasIncoming && !hasOutgoing {
		return ctx
	}

	merged := metadata.MD{}
	if hasOutgoing {
		merged = outgoing.Copy()
	}
	for key, values := range incoming {
		merged[key] = append([]string(nil), values...)
	}

	return metadata.NewOutgoingContext(ctx, merged)
}
