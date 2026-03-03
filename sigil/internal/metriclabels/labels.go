package metriclabels

import "strings"

func Transport(transport string) string {
	switch strings.ToLower(strings.TrimSpace(transport)) {
	case "http":
		return "http"
	case "grpc":
		return "grpc"
	default:
		return "unknown"
	}
}

func Reason(reason string) string {
	trimmed := strings.TrimSpace(reason)
	if trimmed == "" {
		return "unknown"
	}
	return trimmed
}

func TenantID(tenantID string) string {
	trimmed := strings.TrimSpace(tenantID)
	if trimmed == "" {
		return "unknown"
	}
	return trimmed
}
