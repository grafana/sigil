package rules

import (
	"strconv"
	"testing"
)

func TestShouldSampleConversationDeterministic(t *testing.T) {
	first := ShouldSampleConversation("tenant-a", "conv-1", "rule-1", 0.15)
	for i := 0; i < 100; i++ {
		if next := ShouldSampleConversation("tenant-a", "conv-1", "rule-1", 0.15); next != first {
			t.Fatalf("expected deterministic sampling result, got drift at iteration %d", i)
		}
	}
}

func TestShouldSampleConversationDistribution(t *testing.T) {
	const total = 10000
	selected := 0
	for i := 0; i < total; i++ {
		conversationID := "conv-" + strconv.Itoa(i)
		if ShouldSampleConversation("tenant-a", conversationID, "rule-1", 0.2) {
			selected++
		}
	}
	ratio := float64(selected) / float64(total)
	if ratio < 0.17 || ratio > 0.23 {
		t.Fatalf("expected sampled ratio around 0.20, got %.4f", ratio)
	}
}

func TestShouldSampleConversationBoundaries(t *testing.T) {
	if ShouldSampleConversation("tenant-a", "conv-1", "rule-1", 0) {
		t.Fatalf("expected 0%% sample rate to never select")
	}
	if !ShouldSampleConversation("tenant-a", "conv-1", "rule-1", 1) {
		t.Fatalf("expected 100%% sample rate to always select")
	}
}
