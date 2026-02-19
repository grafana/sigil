package modelcards

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"
)

type upstreamSDKResolveCase struct {
	Source   string
	Provider string
	Model    string
}

type resolveCountBucket struct {
	Total      int
	Resolved   int
	Unresolved int
}

func (b *resolveCountBucket) add(resolved bool) {
	b.Total++
	if resolved {
		b.Resolved++
		return
	}
	b.Unresolved++
}

func TestResolveBatch_UpstreamGoSDK_ReportAgainstSnapshot(t *testing.T) {
	cases := collectUpstreamGoSDKResolveCases(t)
	if len(cases) == 0 {
		t.Fatalf("upstream sdk fixture contains no cases")
	}

	snapshot := loadEmbeddedSnapshotForTests(t)
	supplemental := loadEmbeddedSupplementalForTests(t)
	svc := NewServiceWithSupplemental(
		NewMemoryStore(),
		NewStaticErrorSource(fmt.Errorf("disabled for upstream sdk report")),
		snapshot,
		supplemental,
		Config{
			SyncInterval:  30 * time.Minute,
			LeaseTTL:      2 * time.Minute,
			SourceTimeout: 2 * time.Second,
			StaleSoft:     2 * time.Hour,
			StaleHard:     24 * time.Hour,
			BootstrapMode: BootstrapModeSnapshotFirst,
			OwnerID:       "resolver-upstream-sdk-report",
		},
		nil,
	)

	inputs := make([]ResolveInput, 0, len(cases))
	for _, testCase := range cases {
		inputs = append(inputs, ResolveInput{
			Provider: testCase.Provider,
			Model:    testCase.Model,
		})
	}

	results, freshness, err := svc.ResolveBatch(context.Background(), inputs)
	if err != nil {
		t.Fatalf("resolve batch: %v", err)
	}
	if len(results) != len(cases) {
		t.Fatalf("result count mismatch: got=%d want=%d", len(results), len(cases))
	}
	if freshness.SourcePath != SourcePathSnapshotFallback {
		t.Fatalf("expected snapshot fallback source path, got %q", freshness.SourcePath)
	}

	totalResolved := 0
	sourceStats := map[string]*resolveCountBucket{}
	providerStats := map[string]*resolveCountBucket{}
	unresolvedLines := make([]string, 0)

	for idx, testCase := range cases {
		result := results[idx]
		resolved := result.Status == ResolveStatusResolved
		if resolved {
			totalResolved++
		}

		sourceBucket := sourceStats[testCase.Source]
		if sourceBucket == nil {
			sourceBucket = &resolveCountBucket{}
			sourceStats[testCase.Source] = sourceBucket
		}
		sourceBucket.add(resolved)

		providerKey := strings.ToLower(strings.TrimSpace(testCase.Provider))
		providerBucket := providerStats[providerKey]
		if providerBucket == nil {
			providerBucket = &resolveCountBucket{}
			providerStats[providerKey] = providerBucket
		}
		providerBucket.add(resolved)

		if !resolved {
			reason := result.Reason
			if reason == "" {
				reason = "<none>"
			}
			unresolvedLines = append(unresolvedLines, fmt.Sprintf(
				"source=%s provider=%q model=%q reason=%s",
				testCase.Source,
				testCase.Provider,
				testCase.Model,
				reason,
			))
		}
	}

	t.Logf("upstream sdk resolver report")
	t.Logf("snapshot models=%d supplemental models=%d", len(snapshot.Models), len(supplemental.Models))
	t.Logf("freshness source_path=%s stale=%t soft_stale=%t hard_stale=%t", freshness.SourcePath, freshness.Stale, freshness.SoftStale, freshness.HardStale)
	t.Logf("overall resolved=%d/%d recall=%.2f%%", totalResolved, len(cases), percentage(totalResolved, len(cases)))
	logCountBuckets(t, "source", sourceStats)
	logCountBuckets(t, "provider", providerStats)

	t.Logf("unresolved cases (first 120):")
	if len(unresolvedLines) == 0 {
		t.Logf("  none")
	} else {
		sort.Strings(unresolvedLines)
		limit := len(unresolvedLines)
		if limit > 120 {
			limit = 120
		}
		for i := 0; i < limit; i++ {
			t.Logf("  %s", unresolvedLines[i])
		}
		if len(unresolvedLines) > limit {
			t.Logf("  ... %d more unresolved", len(unresolvedLines)-limit)
		}
	}
}

func logCountBuckets(t *testing.T, label string, buckets map[string]*resolveCountBucket) {
	t.Helper()
	keys := make([]string, 0, len(buckets))
	for key := range buckets {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	t.Logf("%s summary:", label)
	if len(keys) == 0 {
		t.Logf("  none")
		return
	}
	for _, key := range keys {
		bucket := buckets[key]
		t.Logf(
			"  %s total=%d resolved=%d unresolved=%d recall=%.2f%%",
			key,
			bucket.Total,
			bucket.Resolved,
			bucket.Unresolved,
			percentage(bucket.Resolved, bucket.Total),
		)
	}
}

func collectUpstreamGoSDKResolveCases(t *testing.T) []upstreamSDKResolveCase {
	t.Helper()

	root := repoRootFromCurrentFile(t)
	modCache := goModCachePath()
	if modCache == "" {
		t.Fatalf("cannot locate go module cache")
	}

	cases := make([]upstreamSDKResolveCase, 0, 256)
	seen := map[string]struct{}{}
	appendCase := func(source string, provider string, model string) {
		source = strings.TrimSpace(source)
		provider = strings.TrimSpace(provider)
		model = strings.TrimSpace(model)
		if source == "" || provider == "" || model == "" {
			return
		}
		key := strings.Join([]string{source, strings.ToLower(provider), model}, "\x00")
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		cases = append(cases, upstreamSDKResolveCase{
			Source:   source,
			Provider: provider,
			Model:    model,
		})
	}

	openAIVersion := moduleVersionFromGoMod(t, filepath.Join(root, "sdks/go-providers/openai/go.mod"), "github.com/openai/openai-go/v3")
	openAISharedPath := filepath.Join(modCache, filepath.FromSlash("github.com/openai/openai-go/v3@"+openAIVersion), "shared/shared.go")
	for _, model := range parseQuotedConstants(t, openAISharedPath, `(?m)^\s*(?:ChatModel|ResponsesModel)[A-Za-z0-9_]+\s+(?:ChatModel|ResponsesModel)\s+=\s+"([^"]+)"\s*$`) {
		appendCase("openai_go_sdk_constants", "openai", model)
	}

	openAIAzureTestPath := filepath.Join(modCache, filepath.FromSlash("github.com/openai/openai-go/v3@"+openAIVersion), "azure/azure_test.go")
	for _, model := range parseQuotedConstants(t, openAIAzureTestPath, `(?m)"model":"([^"]+)"`) {
		appendCase("openai_go_sdk_azure", "azure-openai", model)
		appendCase("openai_go_sdk_azure", "openai", model)
	}
	for _, model := range parseQuotedConstants(t, openAIAzureTestPath, `(?m)WriteField\("model", "([^"]+)"\)`) {
		appendCase("openai_go_sdk_azure", "azure-openai", model)
		appendCase("openai_go_sdk_azure", "openai", model)
	}

	anthropicVersion := moduleVersionFromGoMod(t, filepath.Join(root, "sdks/go-providers/anthropic/go.mod"), "github.com/anthropics/anthropic-sdk-go")
	anthropicMessagePath := filepath.Join(modCache, filepath.FromSlash("github.com/anthropics/anthropic-sdk-go@"+anthropicVersion), "message.go")
	for _, model := range parseQuotedConstants(t, anthropicMessagePath, `(?m)^\s*Model[A-Za-z0-9_]+\s+Model\s+=\s+"([^"]+)"\s*$`) {
		appendCase("anthropic_go_sdk_models", "anthropic", model)
		appendCase("anthropic_go_sdk_vertex", "vertex", model)
	}

	anthropicBedrockTestPath := filepath.Join(modCache, filepath.FromSlash("github.com/anthropics/anthropic-sdk-go@"+anthropicVersion), "bedrock/bedrock_test.go")
	for _, model := range parseQuotedConstants(t, anthropicBedrockTestPath, `(?m)model:\s+"([^"]+)"`) {
		appendCase("anthropic_go_sdk_bedrock", "bedrock", model)
		appendCase("anthropic_go_sdk_bedrock", "aws-bedrock", model)
	}

	genaiVersion := moduleVersionFromGoMod(t, filepath.Join(root, "sdks/go-providers/gemini/go.mod"), "google.golang.org/genai")
	genaiTransformerTestPath := filepath.Join(modCache, filepath.FromSlash("google.golang.org/genai@"+genaiVersion), "transformer_test.go")
	for _, model := range parseQuotedConstants(t, genaiTransformerTestPath, `(?m)input:\s+"([^"]+)"`) {
		normalized := strings.TrimSpace(model)
		if normalized == "" {
			continue
		}
		if !strings.Contains(strings.ToLower(normalized), "gemini") &&
			!strings.HasPrefix(normalized, "models/") &&
			!strings.HasPrefix(normalized, "publishers/") &&
			!strings.HasPrefix(normalized, "projects/") &&
			!strings.HasPrefix(normalized, "tunedModels/") {
			continue
		}
		appendCase("google_genai_go_transformer", "gemini", normalized)
		appendCase("google_genai_go_transformer", "google", normalized)
		appendCase("google_genai_go_transformer", "vertex", normalized)
	}

	if len(cases) == 0 {
		t.Fatalf("failed to collect any upstream go sdk cases")
	}
	return cases
}

func parseQuotedConstants(t *testing.T, path string, expression string) []string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read source file %s: %v", path, err)
	}
	re := regexp.MustCompile(expression)
	matches := re.FindAllStringSubmatch(string(raw), -1)
	values := make([]string, 0, len(matches))
	seen := map[string]struct{}{}
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		value := strings.TrimSpace(match[1])
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
	}
	sort.Strings(values)
	return values
}

func moduleVersionFromGoMod(t *testing.T, path string, modulePath string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read go.mod %s: %v", path, err)
	}
	re := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(modulePath) + `\s+(v[^\s]+)\s*$`)
	match := re.FindStringSubmatch(string(raw))
	if len(match) < 2 {
		t.Fatalf("module %s not found in %s", modulePath, path)
	}
	return strings.TrimSpace(match[1])
}

func repoRootFromCurrentFile(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("runtime caller not available")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "../../.."))
}

func goModCachePath() string {
	if path := strings.TrimSpace(os.Getenv("GOMODCACHE")); path != "" {
		return path
	}
	if gopath := strings.TrimSpace(os.Getenv("GOPATH")); gopath != "" {
		return filepath.Join(gopath, "pkg", "mod")
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, "go", "pkg", "mod")
}
