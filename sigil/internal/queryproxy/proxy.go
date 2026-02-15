package queryproxy

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/grafana/dskit/tenant"
)

type Backend string

const (
	BackendPrometheus Backend = "prometheus"
	BackendTempo      Backend = "tempo"
)

const defaultTimeout = 30 * time.Second

var (
	ErrTenantRequired      = errors.New("tenant header is required")
	ErrPathNotAllowed      = errors.New("path is not allowlisted")
	ErrMethodNotAllowed    = errors.New("method not allowed")
	ErrUpstreamUnavailable = errors.New("upstream unavailable")
)

type Config struct {
	PrometheusBaseURL string
	TempoBaseURL      string
	Timeout           time.Duration
	Client            *http.Client
}

type Proxy struct {
	prometheusBaseURL *url.URL
	tempoBaseURL      *url.URL
	client            *http.Client
}

func New(cfg Config) (*Proxy, error) {
	prometheusBaseURL, err := parseBaseURL(cfg.PrometheusBaseURL)
	if err != nil {
		return nil, fmt.Errorf("prometheus base url: %w", err)
	}
	tempoBaseURL, err := parseBaseURL(cfg.TempoBaseURL)
	if err != nil {
		return nil, fmt.Errorf("tempo base url: %w", err)
	}

	if cfg.Timeout <= 0 {
		cfg.Timeout = defaultTimeout
	}

	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: cfg.Timeout}
	}

	return &Proxy{
		prometheusBaseURL: prometheusBaseURL,
		tempoBaseURL:      tempoBaseURL,
		client:            client,
	}, nil
}

func (p *Proxy) Forward(w http.ResponseWriter, req *http.Request, backend Backend, downstreamPath string) error {
	downstreamPath = normalizePath(downstreamPath)

	pathMatched, methodAllowed := isAllowed(backend, req.Method, downstreamPath)
	if !pathMatched {
		return ErrPathNotAllowed
	}
	if !methodAllowed {
		return ErrMethodNotAllowed
	}

	tenantID, err := tenant.TenantID(req.Context())
	if err != nil {
		return fmt.Errorf("%w: %v", ErrTenantRequired, err)
	}

	upstreamURL, err := p.buildUpstreamURL(backend, downstreamPath, req.URL.RawQuery)
	if err != nil {
		return err
	}

	proxyReq, err := http.NewRequestWithContext(req.Context(), req.Method, upstreamURL, req.Body)
	if err != nil {
		return fmt.Errorf("build upstream request: %w", err)
	}
	proxyReq.ContentLength = req.ContentLength
	copyAllowedRequestHeaders(proxyReq.Header, req.Header)
	stripHopByHopHeaders(proxyReq.Header)
	proxyReq.Header.Set("X-Scope-OrgID", tenantID)

	resp, err := p.client.Do(proxyReq)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUpstreamUnavailable, err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	copyResponseHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
	return nil
}

func (p *Proxy) buildUpstreamURL(backend Backend, downstreamPath string, rawQuery string) (string, error) {
	baseURL, err := p.baseURLForBackend(backend)
	if err != nil {
		return "", err
	}
	upstream := *baseURL
	upstream.Path = joinPaths(baseURL.Path, downstreamPath)
	upstream.RawQuery = rawQuery
	upstream.Fragment = ""
	return upstream.String(), nil
}

func (p *Proxy) baseURLForBackend(backend Backend) (*url.URL, error) {
	switch backend {
	case BackendPrometheus:
		return p.prometheusBaseURL, nil
	case BackendTempo:
		return p.tempoBaseURL, nil
	default:
		return nil, fmt.Errorf("unknown backend %q", backend)
	}
}

func parseBaseURL(rawURL string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, errors.New("scheme must be http or https")
	}
	if parsed.Host == "" {
		return nil, errors.New("host is required")
	}
	return parsed, nil
}

func normalizePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return "/"
	}
	if !strings.HasPrefix(path, "/") {
		return "/" + path
	}
	return path
}

func joinPaths(prefix string, suffix string) string {
	prefix = strings.TrimSuffix(prefix, "/")
	suffix = normalizePath(suffix)
	if prefix == "" {
		return suffix
	}
	return prefix + suffix
}

func isAllowed(backend Backend, method string, path string) (bool, bool) {
	path = normalizePath(path)
	routes := routeTable[backend]
	for _, route := range routes {
		if !route.matcher(path) {
			continue
		}
		_, ok := route.methods[strings.ToUpper(strings.TrimSpace(method))]
		return true, ok
	}
	return false, false
}

type routeRule struct {
	methods map[string]struct{}
	matcher func(path string) bool
}

var routeTable = map[Backend][]routeRule{
	BackendPrometheus: {
		exactRoute([]string{http.MethodGet, http.MethodPost}, "/api/v1/query"),
		exactRoute([]string{http.MethodGet, http.MethodPost}, "/api/v1/query_range"),
		exactRoute([]string{http.MethodGet, http.MethodPost}, "/api/v1/query_exemplars"),
		exactRoute([]string{http.MethodGet, http.MethodPost}, "/api/v1/series"),
		exactRoute([]string{http.MethodGet, http.MethodPost}, "/api/v1/labels"),
		singleSegmentRoute([]string{http.MethodGet}, "/api/v1/label/", "/values"),
		exactRoute([]string{http.MethodGet}, "/api/v1/metadata"),
	},
	BackendTempo: {
		exactRoute([]string{http.MethodGet}, "/api/search"),
		exactRoute([]string{http.MethodGet}, "/api/search/tags"),
		exactRoute([]string{http.MethodGet}, "/api/v2/search/tags"),
		singleSegmentRoute([]string{http.MethodGet}, "/api/search/tag/", "/values"),
		singleSegmentRoute([]string{http.MethodGet}, "/api/v2/search/tag/", "/values"),
		singleSegmentRoute([]string{http.MethodGet}, "/api/traces/", ""),
		singleSegmentRoute([]string{http.MethodGet}, "/api/v2/traces/", ""),
		exactRoute([]string{http.MethodGet}, "/api/metrics/query_range"),
		exactRoute([]string{http.MethodGet}, "/api/metrics/query"),
	},
}

func exactRoute(methods []string, path string) routeRule {
	allowed := make(map[string]struct{}, len(methods))
	for _, method := range methods {
		allowed[strings.ToUpper(strings.TrimSpace(method))] = struct{}{}
	}
	return routeRule{
		methods: allowed,
		matcher: func(candidate string) bool {
			return normalizePath(candidate) == normalizePath(path)
		},
	}
}

func singleSegmentRoute(methods []string, prefix string, suffix string) routeRule {
	allowed := make(map[string]struct{}, len(methods))
	for _, method := range methods {
		allowed[strings.ToUpper(strings.TrimSpace(method))] = struct{}{}
	}
	return routeRule{
		methods: allowed,
		matcher: func(candidate string) bool {
			candidate = normalizePath(candidate)
			if !strings.HasPrefix(candidate, prefix) {
				return false
			}
			if suffix != "" && !strings.HasSuffix(candidate, suffix) {
				return false
			}
			segment := strings.TrimPrefix(candidate, prefix)
			if suffix != "" {
				segment = strings.TrimSuffix(segment, suffix)
			}
			return segment != "" && !strings.Contains(segment, "/")
		},
	}
}

var safeRequestHeaders = []string{
	"Accept",
	"Accept-Encoding",
	"Accept-Language",
	"Cache-Control",
	"Content-Encoding",
	"Content-Type",
	"If-Modified-Since",
	"If-None-Match",
	"Traceparent",
	"Tracestate",
	"Baggage",
	"User-Agent",
	"X-Request-Id",
	"X-Correlation-Id",
}

func copyAllowedRequestHeaders(dst http.Header, src http.Header) {
	for _, headerName := range safeRequestHeaders {
		values := src.Values(headerName)
		for _, value := range values {
			dst.Add(headerName, value)
		}
	}
}

func copyResponseHeaders(dst http.Header, src http.Header) {
	for headerName, values := range src {
		dst[headerName] = append([]string(nil), values...)
	}
	stripHopByHopHeaders(dst)
}

func stripHopByHopHeaders(header http.Header) {
	connectionValues := header.Values("Connection")
	for _, value := range connectionValues {
		for _, token := range strings.Split(value, ",") {
			header.Del(strings.TrimSpace(token))
		}
	}
	for _, headerName := range []string{
		"Connection",
		"Keep-Alive",
		"Proxy-Authenticate",
		"Proxy-Authorization",
		"Proxy-Connection",
		"TE",
		"Trailer",
		"Transfer-Encoding",
		"Upgrade",
	} {
		header.Del(headerName)
	}
}
