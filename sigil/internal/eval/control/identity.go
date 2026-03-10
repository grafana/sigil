package control

import (
	"net/http"
	"os"
	"strings"
)

const (
	HeaderGrafanaUser       = "X-Grafana-User"
	HeaderSigilTrustedActor = "X-Sigil-Trusted-Actor"
	LegacyActorID           = "system@grafana.com"
)

func actorIDFromRequest(w http.ResponseWriter, req *http.Request) (string, bool) {
	if req == nil {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return "", false
	}
	actorID := strings.TrimSpace(req.Header.Get(HeaderGrafanaUser))
	if actorID == "" {
		if isDevelopmentMode() {
			return LegacyActorID, true
		}
		writeControlWriteError(w, UnauthorizedError("grafana user identity is required"))
		return "", false
	}
	if strings.TrimSpace(req.Header.Get(HeaderSigilTrustedActor)) != "true" {
		if isDevelopmentMode() {
			return LegacyActorID, true
		}
		writeControlWriteError(w, UnauthorizedError("trusted grafana user identity is required"))
		return "", false
	}
	return actorID, true
}

func normalizeActorID(actorID string) string {
	trimmed := strings.TrimSpace(actorID)
	if trimmed == "" {
		return LegacyActorID
	}
	return trimmed
}

func isDevelopmentMode() bool {
	value := strings.TrimSpace(os.Getenv("DEVELOPMENT"))
	switch strings.ToLower(value) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
