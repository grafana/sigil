package metriclabels

import "strings"

const unknownLabel = "unknown"

func Transport(transport string) string {
	switch strings.ToLower(strings.TrimSpace(transport)) {
	case "http":
		return "http"
	case "grpc":
		return "grpc"
	default:
		return unknownLabel
	}
}

func Reason(reason string) string {
	return normalizeUnknown(reason)
}

func TenantID(tenantID string) string {
	return normalizeUnknown(tenantID)
}

func normalizeUnknown(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return unknownLabel
	}
	return trimmed
}
