package eval

import "strings"

const LegacyActorID = "system@grafana.com"

func NormalizeActorID(actorID string) string {
	trimmed := strings.TrimSpace(actorID)
	if trimmed == "" {
		return LegacyActorID
	}
	return trimmed
}
