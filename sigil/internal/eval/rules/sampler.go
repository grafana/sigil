package rules

import (
	"fmt"
	"hash/fnv"
)

const sampleBuckets = 10000

func ShouldSampleConversation(tenantID, conversationID, ruleID string, sampleRate float64) bool {
	if sampleRate <= 0 {
		return false
	}
	if sampleRate >= 1 {
		return true
	}

	threshold := int(sampleRate * sampleBuckets)
	if threshold <= 0 {
		return false
	}
	if threshold >= sampleBuckets {
		return true
	}

	hasher := fnv.New64a()
	_, _ = fmt.Fprintf(hasher, "%s|%s|%s", tenantID, conversationID, ruleID)
	bucket := int(hasher.Sum64() % sampleBuckets)
	return bucket < threshold
}
