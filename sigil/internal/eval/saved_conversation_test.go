package eval

import "testing"

func TestSavedConversationSourceValidation(t *testing.T) {
	if !IsValidSavedConversationSource("telemetry") {
		t.Error("expected telemetry to be valid")
	}
	if !IsValidSavedConversationSource("manual") {
		t.Error("expected manual to be valid")
	}
	if IsValidSavedConversationSource("unknown") {
		t.Error("expected unknown to be invalid")
	}
}
