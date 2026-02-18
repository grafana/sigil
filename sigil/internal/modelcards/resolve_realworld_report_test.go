package modelcards

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"
	"time"
)

const (
	realWorldCasesFixturePath = "testdata/resolve_realworld_cases.v1.json"

	expectationTierShouldResolve = "should_resolve"
	expectationTierExploratory   = "exploratory"
)

type resolveRealWorldFixture struct {
	CapturedAt string                    `json:"captured_at"`
	Sources    []resolveRealWorldSource  `json:"sources"`
	Cases      []resolveRealWorldCaseDef `json:"cases"`
}

type resolveRealWorldSource struct {
	Name       string `json:"name"`
	URL        string `json:"url"`
	CapturedAt string `json:"captured_at"`
}

type resolveRealWorldCaseDef struct {
	Source          string `json:"source"`
	Category        string `json:"category"`
	Provider        string `json:"provider"`
	Model           string `json:"model"`
	ExpectationTier string `json:"expectation_tier"`
	Note            string `json:"note"`
}

type resolveReportBucket struct {
	Total                     int
	Resolved                  int
	Unresolved                int
	ShouldResolveTotal        int
	ShouldResolveResolved     int
	ShouldResolveUnresolved   int
	ExploratoryTotal          int
	ExploratoryResolved       int
	ExploratoryUnresolved     int
	UnexpectedResolvedTotal   int
	UnexpectedUnresolvedTotal int
}

func (b *resolveReportBucket) add(expectationTier string, resolved bool) {
	b.Total++
	if resolved {
		b.Resolved++
	} else {
		b.Unresolved++
	}

	switch expectationTier {
	case expectationTierShouldResolve:
		b.ShouldResolveTotal++
		if resolved {
			b.ShouldResolveResolved++
		} else {
			b.ShouldResolveUnresolved++
		}
	case expectationTierExploratory:
		b.ExploratoryTotal++
		if resolved {
			b.ExploratoryResolved++
		} else {
			b.ExploratoryUnresolved++
		}
	default:
		if resolved {
			b.UnexpectedResolvedTotal++
		} else {
			b.UnexpectedUnresolvedTotal++
		}
	}
}

func TestResolveBatch_RealWorldCases_ReportAgainstSnapshot(t *testing.T) {
	fixture := loadResolveRealWorldFixture(t)
	if len(fixture.Cases) == 0 {
		t.Fatalf("fixture contains no cases")
	}

	snapshot := loadEmbeddedSnapshotForTests(t)
	supplemental := loadEmbeddedSupplementalForTests(t)

	svc := NewServiceWithSupplemental(
		NewMemoryStore(),
		NewStaticErrorSource(fmt.Errorf("disabled for report test")),
		snapshot,
		supplemental,
		Config{
			SyncInterval:  30 * time.Minute,
			LeaseTTL:      2 * time.Minute,
			SourceTimeout: 2 * time.Second,
			StaleSoft:     2 * time.Hour,
			StaleHard:     24 * time.Hour,
			BootstrapMode: BootstrapModeSnapshotFirst,
			OwnerID:       "resolver-realworld-report",
		},
		nil,
	)

	inputs := make([]ResolveInput, 0, len(fixture.Cases))
	for _, testCase := range fixture.Cases {
		inputs = append(inputs, ResolveInput{Provider: testCase.Provider, Model: testCase.Model})
	}

	results, freshness, err := svc.ResolveBatch(context.Background(), inputs)
	if err != nil {
		t.Fatalf("resolve batch: %v", err)
	}
	if len(results) != len(fixture.Cases) {
		t.Fatalf("result count mismatch: got %d want %d", len(results), len(fixture.Cases))
	}
	if freshness.SourcePath != SourcePathSnapshotFallback {
		t.Fatalf("expected snapshot fallback read path, got %q", freshness.SourcePath)
	}

	sourceStats := map[string]*resolveReportBucket{}
	categoryStats := map[string]*resolveReportBucket{}
	providerStats := map[string]*resolveReportBucket{}
	tierStats := map[string]*resolveReportBucket{}

	getBucket := func(m map[string]*resolveReportBucket, key string) *resolveReportBucket {
		bucket := m[key]
		if bucket == nil {
			bucket = &resolveReportBucket{}
			m[key] = bucket
		}
		return bucket
	}

	shouldResolveTotal := 0
	shouldResolveResolved := 0
	exploratoryTotal := 0
	exploratoryResolved := 0
	totalResolved := 0

	expectedMisses := make([]string, 0)
	exploratoryUnresolved := make([]string, 0)

	for i, testCase := range fixture.Cases {
		result := results[i]
		resolved := result.Status == ResolveStatusResolved
		if resolved {
			totalResolved++
		}

		if result.Provider != strings.TrimSpace(testCase.Provider) {
			t.Fatalf("result provider mismatch at index %d: got %q want %q", i, result.Provider, testCase.Provider)
		}
		if result.Model != strings.TrimSpace(testCase.Model) {
			t.Fatalf("result model mismatch at index %d: got %q want %q", i, result.Model, testCase.Model)
		}

		getBucket(sourceStats, testCase.Source).add(testCase.ExpectationTier, resolved)
		getBucket(categoryStats, testCase.Category).add(testCase.ExpectationTier, resolved)
		getBucket(providerStats, strings.ToLower(strings.TrimSpace(testCase.Provider))).add(testCase.ExpectationTier, resolved)
		getBucket(tierStats, testCase.ExpectationTier).add(testCase.ExpectationTier, resolved)

		switch testCase.ExpectationTier {
		case expectationTierShouldResolve:
			shouldResolveTotal++
			if resolved {
				shouldResolveResolved++
			} else {
				expectedMisses = append(expectedMisses, formatResolveCaseLine(testCase, result))
			}
		case expectationTierExploratory:
			exploratoryTotal++
			if resolved {
				exploratoryResolved++
			} else {
				exploratoryUnresolved = append(exploratoryUnresolved, formatResolveCaseLine(testCase, result))
			}
		default:
			t.Fatalf("unknown expectation_tier %q in fixture at index %d", testCase.ExpectationTier, i)
		}
	}

	totalCases := len(fixture.Cases)
	totalRecall := percentage(totalResolved, totalCases)
	shouldResolveRecall := percentage(shouldResolveResolved, shouldResolveTotal)
	exploratoryRecall := percentage(exploratoryResolved, exploratoryTotal)

	t.Logf("resolver real-world report")
	t.Logf("fixture=%s captured_at=%s sources=%d cases=%d", realWorldCasesFixturePath, fixture.CapturedAt, len(fixture.Sources), totalCases)
	t.Logf("snapshot models=%d supplemental models=%d", len(snapshot.Models), len(supplemental.Models))
	t.Logf("freshness source_path=%s stale=%t soft_stale=%t hard_stale=%t", freshness.SourcePath, freshness.Stale, freshness.SoftStale, freshness.HardStale)
	t.Logf("overall resolved=%d/%d recall=%.2f%%", totalResolved, totalCases, totalRecall)
	t.Logf("should_resolve resolved=%d/%d recall=%.2f%% misses=%d", shouldResolveResolved, shouldResolveTotal, shouldResolveRecall, len(expectedMisses))
	t.Logf("exploratory resolved=%d/%d recall=%.2f%% unresolved=%d", exploratoryResolved, exploratoryTotal, exploratoryRecall, len(exploratoryUnresolved))

	logResolveBucketReport(t, "source", sourceStats)
	logResolveBucketReport(t, "category", categoryStats)
	logResolveBucketReport(t, "provider", providerStats)
	logResolveBucketReport(t, "tier", tierStats)

	t.Logf("expected misses (should_resolve unresolved):")
	if len(expectedMisses) == 0 {
		t.Logf("  none")
	} else {
		sort.Strings(expectedMisses)
		for _, line := range expectedMisses {
			t.Logf("  %s", line)
		}
	}

	t.Logf("exploratory unresolved (full list):")
	if len(exploratoryUnresolved) == 0 {
		t.Logf("  none")
	} else {
		sort.Strings(exploratoryUnresolved)
		for _, line := range exploratoryUnresolved {
			t.Logf("  %s", line)
		}
	}
}

func TestResolveBatch_OpenRouterLiveSnapshotDrift_Report(t *testing.T) {
	if strings.TrimSpace(os.Getenv("SIGIL_MODEL_CARDS_LIVE_REPORT")) != "1" {
		t.Skip("set SIGIL_MODEL_CARDS_LIVE_REPORT=1 to enable live OpenRouter drift report")
	}

	snapshot := loadEmbeddedSnapshotForTests(t)
	supplemental := loadEmbeddedSupplementalForTests(t)
	snapshotIDs := make(map[string]struct{}, len(snapshot.Models))
	for _, model := range snapshot.Models {
		snapshotIDs[strings.ToLower(strings.TrimSpace(model.SourceModelID))] = struct{}{}
	}
	for _, model := range supplemental.Models {
		snapshotIDs[strings.ToLower(strings.TrimSpace(model.SourceModelID))] = struct{}{}
	}

	source := NewOpenRouterSource(45 * time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
	defer cancel()

	liveCards, err := source.Fetch(ctx)
	if err != nil {
		t.Fatalf("fetch live OpenRouter models: %v", err)
	}

	liveIDs := make(map[string]struct{}, len(liveCards))
	for _, card := range liveCards {
		liveIDs[strings.ToLower(strings.TrimSpace(card.SourceModelID))] = struct{}{}
	}

	missingFromSnapshot := setDifference(liveIDs, snapshotIDs)
	staleOnlyInSnapshot := setDifference(snapshotIDs, liveIDs)

	t.Logf("openrouter live drift report")
	t.Logf("snapshot_plus_supplemental_models=%d live_models=%d", len(snapshotIDs), len(liveIDs))
	t.Logf("live_missing_in_snapshot=%d snapshot_missing_in_live=%d", len(missingFromSnapshot), len(staleOnlyInSnapshot))

	liveProviderCounts := providerCountsFromIDSet(liveIDs)
	missingProviderCounts := providerCountsFromIDs(missingFromSnapshot)

	t.Logf("live provider counts:")
	for _, line := range sortedCountLines(liveProviderCounts) {
		t.Logf("  %s", line)
	}

	t.Logf("provider counts for models missing in snapshot:")
	if len(missingProviderCounts) == 0 {
		t.Logf("  none")
	} else {
		for _, line := range sortedCountLines(missingProviderCounts) {
			t.Logf("  %s", line)
		}
	}

	t.Logf("full model IDs missing in snapshot:")
	if len(missingFromSnapshot) == 0 {
		t.Logf("  none")
	} else {
		for _, id := range missingFromSnapshot {
			t.Logf("  %s", id)
		}
	}

	t.Logf("full model IDs present only in snapshot:")
	if len(staleOnlyInSnapshot) == 0 {
		t.Logf("  none")
	} else {
		for _, id := range staleOnlyInSnapshot {
			t.Logf("  %s", id)
		}
	}
}

func loadResolveRealWorldFixture(t *testing.T) resolveRealWorldFixture {
	t.Helper()

	raw, err := os.ReadFile(realWorldCasesFixturePath)
	if err != nil {
		t.Fatalf("read fixture file: %v", err)
	}

	var fixture resolveRealWorldFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode fixture file: %v", err)
	}

	if strings.TrimSpace(fixture.CapturedAt) == "" {
		t.Fatalf("fixture captured_at is required")
	}
	if len(fixture.Sources) == 0 {
		t.Fatalf("fixture sources are required")
	}
	if len(fixture.Cases) == 0 {
		t.Fatalf("fixture cases are required")
	}

	for i, source := range fixture.Sources {
		if strings.TrimSpace(source.Name) == "" {
			t.Fatalf("fixture source[%d].name is required", i)
		}
		if strings.TrimSpace(source.URL) == "" {
			t.Fatalf("fixture source[%d].url is required", i)
		}
		if strings.TrimSpace(source.CapturedAt) == "" {
			t.Fatalf("fixture source[%d].captured_at is required", i)
		}
	}

	for i, testCase := range fixture.Cases {
		if strings.TrimSpace(testCase.Source) == "" {
			t.Fatalf("fixture case[%d].source is required", i)
		}
		if strings.TrimSpace(testCase.Category) == "" {
			t.Fatalf("fixture case[%d].category is required", i)
		}
		if strings.TrimSpace(testCase.Provider) == "" {
			t.Fatalf("fixture case[%d].provider is required", i)
		}
		if strings.TrimSpace(testCase.Model) == "" {
			t.Fatalf("fixture case[%d].model is required", i)
		}
		if strings.TrimSpace(testCase.ExpectationTier) == "" {
			t.Fatalf("fixture case[%d].expectation_tier is required", i)
		}
	}

	return fixture
}

func loadEmbeddedSnapshotForTests(t *testing.T) *Snapshot {
	t.Helper()

	snapshot, err := LoadEmbeddedSnapshot()
	if err != nil {
		t.Fatalf("load embedded snapshot: %v", err)
	}
	return snapshot
}

func loadEmbeddedSupplementalForTests(t *testing.T) *SupplementalCatalog {
	t.Helper()

	supplemental, err := LoadEmbeddedSupplemental()
	if err != nil {
		t.Fatalf("load embedded supplemental catalog: %v", err)
	}
	return supplemental
}

func logResolveBucketReport(t *testing.T, label string, buckets map[string]*resolveReportBucket) {
	t.Helper()

	if len(buckets) == 0 {
		t.Logf("%s summary: none", label)
		return
	}

	keys := make([]string, 0, len(buckets))
	for key := range buckets {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	t.Logf("%s summary:", label)
	for _, key := range keys {
		bucket := buckets[key]
		totalRecall := percentage(bucket.Resolved, bucket.Total)
		shouldResolveRecall := percentage(bucket.ShouldResolveResolved, bucket.ShouldResolveTotal)
		exploratoryRecall := percentage(bucket.ExploratoryResolved, bucket.ExploratoryTotal)
		t.Logf(
			"  %s total=%d resolved=%d unresolved=%d recall=%.2f%% should_resolve=%d/%d (%.2f%%) exploratory=%d/%d (%.2f%%)",
			key,
			bucket.Total,
			bucket.Resolved,
			bucket.Unresolved,
			totalRecall,
			bucket.ShouldResolveResolved,
			bucket.ShouldResolveTotal,
			shouldResolveRecall,
			bucket.ExploratoryResolved,
			bucket.ExploratoryTotal,
			exploratoryRecall,
		)
	}
}

func percentage(numerator int, denominator int) float64 {
	if denominator <= 0 {
		return 0
	}
	return (float64(numerator) / float64(denominator)) * 100
}

func formatResolveCaseLine(testCase resolveRealWorldCaseDef, result ResolveResult) string {
	status := result.Status
	if status == "" {
		status = "<empty>"
	}
	reason := result.Reason
	if reason == "" {
		reason = "<none>"
	}
	strategy := result.MatchStrategy
	if strategy == "" {
		strategy = "<none>"
	}
	resolvedModelKey := "<none>"
	resolvedSourceModelID := "<none>"
	if result.Card != nil {
		resolvedModelKey = strings.TrimSpace(result.Card.ModelKey)
		resolvedSourceModelID = strings.TrimSpace(result.Card.SourceModelID)
		if resolvedModelKey == "" {
			resolvedModelKey = "<empty>"
		}
		if resolvedSourceModelID == "" {
			resolvedSourceModelID = "<empty>"
		}
	}

	return fmt.Sprintf(
		"source=%s category=%s tier=%s provider=%q model=%q status=%s reason=%s strategy=%s resolved_model_key=%s resolved_source_model_id=%s note=%q",
		testCase.Source,
		testCase.Category,
		testCase.ExpectationTier,
		testCase.Provider,
		testCase.Model,
		status,
		reason,
		strategy,
		resolvedModelKey,
		resolvedSourceModelID,
		testCase.Note,
	)
}

func setDifference(left map[string]struct{}, right map[string]struct{}) []string {
	out := make([]string, 0)
	for key := range left {
		if _, ok := right[key]; ok {
			continue
		}
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

func providerCountsFromIDSet(ids map[string]struct{}) map[string]int {
	out := make(map[string]int)
	for id := range ids {
		provider := providerFromModelIDValue(id)
		if provider == "" {
			provider = "<unknown>"
		}
		out[provider]++
	}
	return out
}

func providerCountsFromIDs(ids []string) map[string]int {
	out := make(map[string]int)
	for _, id := range ids {
		provider := providerFromModelIDValue(id)
		if provider == "" {
			provider = "<unknown>"
		}
		out[provider]++
	}
	return out
}

func sortedCountLines(counts map[string]int) []string {
	if len(counts) == 0 {
		return nil
	}
	type pair struct {
		key   string
		count int
	}
	pairs := make([]pair, 0, len(counts))
	for key, count := range counts {
		pairs = append(pairs, pair{key: key, count: count})
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].count == pairs[j].count {
			return pairs[i].key < pairs[j].key
		}
		return pairs[i].count > pairs[j].count
	})

	out := make([]string, 0, len(pairs))
	for _, pair := range pairs {
		out = append(out, fmt.Sprintf("%s:%d", pair.key, pair.count))
	}
	return out
}

func providerFromModelIDValue(sourceModelID string) string {
	trimmed := strings.TrimSpace(strings.ToLower(sourceModelID))
	if trimmed == "" {
		return ""
	}
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) != 2 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}
