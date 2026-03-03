# Eval Quick-Test Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a synchronous `POST /api/v1/eval:test` endpoint and UI panel that lets users test evaluator configs against a real generation before publishing.

**Architecture:** A new `TestService` in the control package composes the existing `GenerationReader`, `evaluators.Evaluator` implementations, and `evaluators.InputFromGeneration()` to run an evaluator config synchronously against a fetched generation. The plugin proxies the request, and a reusable `EvalTestPanel` React component provides the generation picker + run + result display.

**Tech Stack:** Go (HTTP handler, evaluator composition), TypeScript/React (Grafana UI components), existing conversation search APIs for generation picking.

**Design doc:** `docs/plans/2026-03-03-eval-quick-test-design.md`

---

### Task 1: Add TestService to control package

**Files:**
- Create: `sigil/internal/eval/control/test_service.go`
- Test: `sigil/internal/eval/control/test_service_test.go`

The TestService is intentionally separate from Service because it has different dependencies (GenerationReader + evaluator registry) that the control Service doesn't need for its CRUD operations.

**Step 1: Write the test**

```go
// test_service_test.go
package control

import (
	"context"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubGenerationReader struct {
	generation *sigilv1.Generation
	err        error
}

func (r *stubGenerationReader) GetByID(_ context.Context, _, _ string) (*sigilv1.Generation, error) {
	return r.generation, r.err
}

type stubEvaluator struct {
	kind   evalpkg.EvaluatorKind
	scores []evaluators.ScoreOutput
	err    error
}

func (e *stubEvaluator) Kind() evalpkg.EvaluatorKind { return e.kind }
func (e *stubEvaluator) Evaluate(_ context.Context, _ evaluators.EvalInput, _ evalpkg.EvaluatorDefinition) ([]evaluators.ScoreOutput, error) {
	return e.scores, e.err
}

func TestTestService_RunTest(t *testing.T) {
	gen := &sigilv1.Generation{
		Id:             "gen-1",
		ConversationId: "conv-1",
	}
	reader := &stubGenerationReader{generation: gen}
	eval := &stubEvaluator{
		kind: evalpkg.EvaluatorKindRegex,
		scores: []evaluators.ScoreOutput{
			{Key: "match", Type: evalpkg.ScoreTypeBool, Value: true, Explanation: "matched"},
		},
	}
	svc := NewTestService(reader, map[evalpkg.EvaluatorKind]evaluators.Evaluator{
		evalpkg.EvaluatorKindRegex: eval,
	})

	resp, err := svc.RunTest(context.Background(), "tenant-1", EvalTestRequest{
		Kind:         "regex",
		Config:       map[string]any{"pattern": ".*"},
		OutputKeys:   []evalpkg.OutputKey{{Key: "match", Type: evalpkg.ScoreTypeBool}},
		GenerationID: "gen-1",
	})
	require.NoError(t, err)
	assert.Equal(t, "gen-1", resp.GenerationID)
	assert.Equal(t, "conv-1", resp.ConversationID)
	require.Len(t, resp.Scores, 1)
	assert.Equal(t, "match", resp.Scores[0].Key)
}

func TestTestService_RunTest_ValidationErrors(t *testing.T) {
	svc := NewTestService(&stubGenerationReader{}, map[evalpkg.EvaluatorKind]evaluators.Evaluator{})

	tests := []struct {
		name string
		req  EvalTestRequest
	}{
		{"empty kind", EvalTestRequest{Config: map[string]any{}, OutputKeys: []evalpkg.OutputKey{{Key: "k", Type: "number"}}, GenerationID: "g"}},
		{"invalid kind", EvalTestRequest{Kind: "bad", Config: map[string]any{}, OutputKeys: []evalpkg.OutputKey{{Key: "k", Type: "number"}}, GenerationID: "g"}},
		{"empty config", EvalTestRequest{Kind: "regex", OutputKeys: []evalpkg.OutputKey{{Key: "k", Type: "number"}}, GenerationID: "g"}},
		{"empty output_keys", EvalTestRequest{Kind: "regex", Config: map[string]any{}, GenerationID: "g"}},
		{"empty generation_id", EvalTestRequest{Kind: "regex", Config: map[string]any{}, OutputKeys: []evalpkg.OutputKey{{Key: "k", Type: "number"}}}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.RunTest(context.Background(), "tenant-1", tc.req)
			require.Error(t, err)
			assert.True(t, isValidationError(err))
		})
	}
}

func TestTestService_RunTest_GenerationNotFound(t *testing.T) {
	reader := &stubGenerationReader{generation: nil}
	eval := &stubEvaluator{kind: evalpkg.EvaluatorKindRegex}
	svc := NewTestService(reader, map[evalpkg.EvaluatorKind]evaluators.Evaluator{
		evalpkg.EvaluatorKindRegex: eval,
	})

	_, err := svc.RunTest(context.Background(), "tenant-1", EvalTestRequest{
		Kind:         "regex",
		Config:       map[string]any{"pattern": ".*"},
		OutputKeys:   []evalpkg.OutputKey{{Key: "match", Type: evalpkg.ScoreTypeBool}},
		GenerationID: "gen-missing",
	})
	require.Error(t, err)
	assert.True(t, isNotFoundError(err))
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./sigil/internal/eval/control/ -run TestTestService -v`
Expected: FAIL — types and functions don't exist yet.

**Step 3: Write the implementation**

```go
// test_service.go
package control

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
	"github.com/grafana/sigil/sigil/internal/eval/evaluators"
	"github.com/grafana/sigil/sigil/internal/eval/worker"
)

// EvalTestRequest is the input for running an ad-hoc evaluator test.
type EvalTestRequest struct {
	Kind         string              `json:"kind"`
	Config       map[string]any      `json:"config"`
	OutputKeys   []evalpkg.OutputKey `json:"output_keys"`
	GenerationID string              `json:"generation_id"`
}

// EvalTestScore represents a single score in the test response.
type EvalTestScore struct {
	Key         string         `json:"key"`
	Type        string         `json:"type"`
	Value       any            `json:"value"`
	Passed      *bool          `json:"passed,omitempty"`
	Explanation string         `json:"explanation,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// EvalTestResponse is the output from running an ad-hoc evaluator test.
type EvalTestResponse struct {
	GenerationID    string          `json:"generation_id"`
	ConversationID  string          `json:"conversation_id"`
	Scores          []EvalTestScore `json:"scores"`
	ExecutionTimeMs int64           `json:"execution_time_ms"`
}

type notFoundError struct{ cause error }

func (e notFoundError) Error() string { return e.cause.Error() }
func (e notFoundError) Unwrap() error { return e.cause }

func isNotFoundError(err error) bool {
	var target notFoundError
	return errors.As(err, &target)
}

// TestService handles ad-hoc evaluator testing without persisting results.
type TestService struct {
	reader     worker.GenerationReader
	evaluators map[evalpkg.EvaluatorKind]evaluators.Evaluator
}

// NewTestService creates a TestService with a generation reader and evaluator registry.
func NewTestService(reader worker.GenerationReader, evals map[evalpkg.EvaluatorKind]evaluators.Evaluator) *TestService {
	return &TestService{reader: reader, evaluators: evals}
}

// RunTest validates the request, fetches the generation, runs the evaluator, and returns scores.
func (s *TestService) RunTest(ctx context.Context, tenantID string, req EvalTestRequest) (*EvalTestResponse, error) {
	kind := evalpkg.EvaluatorKind(strings.TrimSpace(req.Kind))
	if err := validateKind(kind); err != nil {
		return nil, newValidationError(err)
	}
	if len(req.Config) == 0 {
		return nil, newValidationError(errors.New("config is required"))
	}
	if err := validateOutputKeys(req.OutputKeys); err != nil {
		return nil, newValidationError(err)
	}
	generationID := strings.TrimSpace(req.GenerationID)
	if generationID == "" {
		return nil, newValidationError(errors.New("generation_id is required"))
	}

	evaluator, ok := s.evaluators[kind]
	if !ok {
		return nil, newValidationError(fmt.Errorf("no evaluator registered for kind %q", kind))
	}

	generation, err := s.reader.GetByID(ctx, strings.TrimSpace(tenantID), generationID)
	if err != nil {
		return nil, fmt.Errorf("fetch generation: %w", err)
	}
	if generation == nil {
		return nil, notFoundError{cause: fmt.Errorf("generation %q not found", generationID)}
	}

	input := evaluators.InputFromGeneration(strings.TrimSpace(tenantID), generation)
	definition := evalpkg.EvaluatorDefinition{
		Kind:       kind,
		Config:     req.Config,
		OutputKeys: req.OutputKeys,
	}

	start := time.Now()
	scores, err := evaluator.Evaluate(ctx, input, definition)
	elapsed := time.Since(start)
	if err != nil {
		return nil, fmt.Errorf("evaluator execution failed: %w", err)
	}

	testScores := make([]EvalTestScore, 0, len(scores))
	for _, score := range scores {
		testScores = append(testScores, EvalTestScore{
			Key:         score.Key,
			Type:        string(score.Type),
			Value:       score.Value,
			Passed:      score.Passed,
			Explanation: score.Explanation,
			Metadata:    score.Metadata,
		})
	}

	return &EvalTestResponse{
		GenerationID:    generation.GetId(),
		ConversationID:  generation.GetConversationId(),
		Scores:          testScores,
		ExecutionTimeMs: elapsed.Milliseconds(),
	}, nil
}
```

**Step 4: Run test to verify it passes**

Run: `go test ./sigil/internal/eval/control/ -run TestTestService -v`
Expected: PASS

**Step 5: Commit**

```bash
git add sigil/internal/eval/control/test_service.go sigil/internal/eval/control/test_service_test.go
git commit -m "feat(eval): add TestService for ad-hoc evaluator testing"
```

---

### Task 2: Add HTTP handler and route registration

**Files:**
- Create: `sigil/internal/eval/control/http_test.go`
- Modify: `sigil/internal/eval/control/http.go:44-66` (RegisterHTTPRoutes)

**Step 1: Write the HTTP handler**

Add to `http.go` — new handler method on `TestService`:

```go
func (s *TestService) handleEvalTest(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var testReq EvalTestRequest
	if err := decodeJSONBody(req, &testReq); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(req.Context(), 30*time.Second)
	defer cancel()

	resp, err := s.RunTest(ctx, tenantID, testReq)
	if err != nil {
		if isValidationError(err) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if isNotFoundError(err) {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		if ctx.Err() != nil {
			http.Error(w, "evaluation timed out", http.StatusGatewayTimeout)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}
```

**Step 2: Register the route**

In `RegisterHTTPRoutes`, add a `testService *TestService` parameter and register:

```go
func RegisterHTTPRoutes(mux *http.ServeMux, service *Service, templateService *TemplateService, testService *TestService, protectedMiddleware func(http.Handler) http.Handler) {
	// ... existing routes ...

	if testService != nil {
		mux.Handle("POST /api/v1/eval:test", protectedMiddleware(http.HandlerFunc(testService.handleEvalTest)))
	}
}
```

**Step 3: Run tests**

Run: `go test ./sigil/internal/eval/control/ -v`
Expected: PASS (existing tests may need `RegisterHTTPRoutes` signature updated in test calls)

**Step 4: Commit**

```bash
git add sigil/internal/eval/control/http.go sigil/internal/eval/control/http_test.go
git commit -m "feat(eval): add POST /api/v1/eval:test HTTP handler and route"
```

---

### Task 3: Wire TestService in querier module

**Files:**
- Modify: `sigil/internal/querier_module.go:109-194`

**Step 1: Create TestService alongside controlSvc**

Inside the `if evalStore, ok := ...` block in `newQuerierModule`, after the discovery is created:

1. Build a `GenerationReader` from the same stores available in querier (WAL + block reader).
2. Build the evaluator map (same as worker does, but without worker config).
3. Construct `TestService`.

```go
// After discovery := judges.DiscoverFromEnv() (line ~113)

// Build generation reader for test service.
var testSvc *evalcontrol.TestService
generationReader := evalworker.NewHotColdGenerationReader(
	generationStore.(evalworker.GenerationReader),
	blockMetadataStore,
	blockReader,
)
if generationReader != nil {
	evalRegistry := map[evalpkg.EvaluatorKind]evaluators.Evaluator{
		evalpkg.EvaluatorKindRegex:      evaluators.NewRegexEvaluator(),
		evalpkg.EvaluatorKindJSONSchema: evaluators.NewJSONSchemaEvaluator(),
		evalpkg.EvaluatorKindHeuristic:  evaluators.NewHeuristicEvaluator(),
		evalpkg.EvaluatorKindLLMJudge:   evaluators.NewLLMJudgeEvaluator(discovery, cfg.EvalDefaultJudgeModel),
	}
	testSvc = evalcontrol.NewTestService(generationReader, evalRegistry)
}
```

2. Update the `RegisterHTTPRoutes` call to pass `testSvc`:

```go
evalcontrol.RegisterHTTPRoutes(mux, controlSvc, templateSvc, testSvc, protectedMiddleware)
```

**Step 2: Check it compiles**

Run: `go build ./sigil/...`
Expected: Success

**Step 3: Run full test suite**

Run: `go test ./sigil/internal/eval/... -v`
Expected: PASS

**Step 4: Commit**

```bash
git add sigil/internal/querier_module.go
git commit -m "feat(eval): wire TestService in querier module"
```

---

### Task 4: Add plugin proxy route

**Files:**
- Modify: `apps/plugin/pkg/plugin/resources.go`

**Step 1: Add handler function**

Follow existing pattern (e.g., `handleEvalRulesPreview`):

```go
func (a *App) handleEvalTest(w http.ResponseWriter, req *http.Request) {
	a.handleProxy(w, req, "/api/v1/eval:test", http.MethodPost)
}
```

**Step 2: Register in route setup**

In the route registration block (around line 544), add:

```go
mux.HandleFunc("/eval:test", a.handleEvalTest)
```

**Step 3: Verify build**

Run: `go build ./apps/plugin/...`
Expected: Success

**Step 4: Commit**

```bash
git add apps/plugin/pkg/plugin/resources.go
git commit -m "feat(plugin): add eval:test proxy route"
```

---

### Task 5: Add TypeScript types

**Files:**
- Modify: `apps/plugin/src/evaluation/types.ts`

**Step 1: Add types at end of file**

```ts
export type EvalTestRequest = {
  kind: EvaluatorKind;
  config: Record<string, unknown>;
  output_keys: EvalOutputKey[];
  generation_id: string;
};

export type EvalTestScore = {
  key: string;
  type: ScoreType;
  value: unknown;
  passed?: boolean;
  explanation?: string;
  metadata?: Record<string, unknown>;
};

export type EvalTestResponse = {
  generation_id: string;
  conversation_id: string;
  scores: EvalTestScore[];
  execution_time_ms: number;
};
```

**Step 2: Commit**

```bash
git add apps/plugin/src/evaluation/types.ts
git commit -m "feat(plugin): add eval test request/response types"
```

---

### Task 6: Add API client method

**Files:**
- Modify: `apps/plugin/src/evaluation/api.ts`

**Step 1: Add to interface and implementation**

Add `testEval` to `EvaluationDataSource`:

```ts
testEval: (request: EvalTestRequest) => Promise<EvalTestResponse>;
```

Add implementation to `defaultEvaluationDataSource`:

```ts
async testEval(request) {
  const response = await lastValueFrom(
    getBackendSrv().fetch<EvalTestResponse>({
      method: 'POST',
      url: `${evalBasePath}:test`,
      data: request,
    })
  );
  return response.data;
},
```

**Step 2: Update imports**

Add `EvalTestRequest`, `EvalTestResponse` to the type imports.

**Step 3: Verify types**

Run: `mise run check`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/plugin/src/evaluation/api.ts
git commit -m "feat(plugin): add testEval API client method"
```

---

### Task 7: Create GenerationPicker component

**Files:**
- Create: `apps/plugin/src/components/evaluation/GenerationPicker.tsx`

This is a self-contained picker that uses the existing `ConversationsDataSource` to search conversations and select a generation.

**Flow:**
1. User types in search field → debounced search via `searchConversations`
2. Results show as a compact list of conversations
3. Clicking a conversation fetches detail via `getConversationDetail`
4. Generations within the conversation are listed
5. Clicking a generation calls `onSelect(generationId)`

**Props:**
```ts
type GenerationPickerProps = {
  onSelect: (generationId: string) => void;
  selectedGenerationId?: string;
};
```

**Implementation sketch:**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, Input, Spinner, Text, useStyles2 } from '@grafana/ui';
import { defaultConversationsDataSource } from '../../conversation/api';
import type { ConversationDetail, ConversationSearchResult } from '../../conversation/types';
import type { GenerationDetail } from '../../generation/types';

export type GenerationPickerProps = {
  onSelect: (generationId: string) => void;
  selectedGenerationId?: string;
};

export default function GenerationPicker({ onSelect, selectedGenerationId }: GenerationPickerProps) {
  const styles = useStyles2(getStyles);
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState<ConversationSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<ConversationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Search conversations on mount (empty search = recent) and on query change.
  const search = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const result = await defaultConversationsDataSource.searchConversations({
        filters: q || '*',
        select: [],
        time_range: {
          from: weekAgo.toISOString(),
          to: now.toISOString(),
        },
        page_size: 20,
      });
      setConversations(result.conversations ?? []);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    search('');
  }, [search]);

  // Debounced search on query change.
  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  const handleConversationClick = async (conversationId: string) => {
    setLoadingDetail(true);
    try {
      const detail = await defaultConversationsDataSource.getConversationDetail(conversationId);
      setSelectedConversation(detail);
    } catch {
      setSelectedConversation(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleBack = () => setSelectedConversation(null);

  // If a conversation is selected, show its generations.
  if (selectedConversation) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Button variant="secondary" size="sm" icon="arrow-left" onClick={handleBack}>
            Back
          </Button>
          <Text variant="bodySmall" color="secondary">
            {selectedConversation.conversation_id}
          </Text>
        </div>
        <div className={styles.list}>
          {(selectedConversation.generations ?? []).map((gen: GenerationDetail) => (
            <div
              key={gen.generation_id}
              className={
                gen.generation_id === selectedGenerationId ? styles.selectedRow : styles.row
              }
              onClick={() => onSelect(gen.generation_id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(gen.generation_id)}
            >
              <Text variant="bodySmall" weight="medium" truncate>
                {gen.generation_id}
              </Text>
              <Text variant="bodySmall" color="secondary">
                {gen.model?.name ?? '—'} · {gen.created_at ? new Date(gen.created_at).toLocaleString() : '—'}
              </Text>
            </div>
          ))}
          {loadingDetail && <Spinner />}
        </div>
      </div>
    );
  }

  // Show conversation search list.
  return (
    <div className={styles.container}>
      <Input
        placeholder="Search conversations..."
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        prefix={loading ? <Spinner inline /> : undefined}
      />
      <div className={styles.list}>
        {conversations.map((conv) => (
          <div
            key={conv.conversation_id}
            className={styles.row}
            onClick={() => handleConversationClick(conv.conversation_id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleConversationClick(conv.conversation_id)}
          >
            <Text variant="bodySmall" weight="medium" truncate>
              {conv.conversation_id}
            </Text>
            <Text variant="bodySmall" color="secondary">
              {conv.generation_count ?? 0} generations · {conv.last_generation_at ? new Date(conv.last_generation_at).toLocaleString() : '—'}
            </Text>
          </div>
        ))}
        {!loading && conversations.length === 0 && (
          <Text variant="bodySmall" color="secondary">
            No conversations found.
          </Text>
        )}
      </div>
    </div>
  );
}
```

Styles: compact container with max-height + scroll, rows with hover.

**Step 1: Create the component file**
**Step 2: Verify types**

Run: `mise run check`

**Step 3: Commit**

```bash
git add apps/plugin/src/components/evaluation/GenerationPicker.tsx
git commit -m "feat(plugin): add GenerationPicker component"
```

---

### Task 8: Create TestResultDisplay component

**Files:**
- Create: `apps/plugin/src/components/evaluation/TestResultDisplay.tsx`

Renders the test response inline.

```tsx
import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Text, useStyles2 } from '@grafana/ui';
import type { EvalTestResponse } from '../../evaluation/types';

export type TestResultDisplayProps = {
  result: EvalTestResponse;
};

export default function TestResultDisplay({ result }: TestResultDisplayProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.container}>
      <div className={styles.meta}>
        <Text variant="bodySmall" color="secondary">
          Generation: {result.generation_id}
        </Text>
        <Text variant="bodySmall" color="secondary">
          {result.execution_time_ms}ms
        </Text>
      </div>
      {result.scores.map((score) => (
        <div key={score.key} className={styles.scoreRow}>
          <div className={styles.scoreHeader}>
            <Text weight="medium">{score.key}</Text>
            <Badge text={String(score.value)} color={score.passed === false ? 'red' : 'green'} />
            <Text variant="bodySmall" color="secondary">
              ({score.type})
            </Text>
            {score.passed != null && (
              <Badge text={score.passed ? 'PASS' : 'FAIL'} color={score.passed ? 'green' : 'red'} />
            )}
          </div>
          {score.explanation && (
            <Text variant="bodySmall" color="secondary">
              {score.explanation}
            </Text>
          )}
        </div>
      ))}
    </div>
  );
}
```

**Step 1: Create the component file**
**Step 2: Verify types**

Run: `mise run check`

**Step 3: Commit**

```bash
git add apps/plugin/src/components/evaluation/TestResultDisplay.tsx
git commit -m "feat(plugin): add TestResultDisplay component"
```

---

### Task 9: Create EvalTestPanel component

**Files:**
- Create: `apps/plugin/src/components/evaluation/EvalTestPanel.tsx`

Composes GenerationPicker + Run button + TestResultDisplay. This is the reusable panel that can be embedded in any form that has kind/config/outputKeys.

**Props:**
```ts
type EvalTestPanelProps = {
  kind: EvaluatorKind;
  config: Record<string, unknown>;
  outputKeys: EvalOutputKey[];
  dataSource?: EvaluationDataSource;
};
```

**Behavior:**
1. "Test" button expands the panel
2. User picks a generation via GenerationPicker
3. "Run Test" sends the request via `dataSource.testEval()`
4. Result displayed via TestResultDisplay
5. User can change config in parent form and re-run without re-picking

```tsx
import React, { useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Spinner, Stack, Text, useStyles2 } from '@grafana/ui';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../../evaluation/api';
import type { EvalOutputKey, EvalTestResponse, EvaluatorKind } from '../../evaluation/types';
import GenerationPicker from './GenerationPicker';
import TestResultDisplay from './TestResultDisplay';

export type EvalTestPanelProps = {
  kind: EvaluatorKind;
  config: Record<string, unknown>;
  outputKeys: EvalOutputKey[];
  dataSource?: EvaluationDataSource;
};

export default function EvalTestPanel({ kind, config, outputKeys, dataSource }: EvalTestPanelProps) {
  const styles = useStyles2(getStyles);
  const ds = dataSource ?? defaultEvaluationDataSource;

  const [expanded, setExpanded] = useState(false);
  const [generationId, setGenerationId] = useState<string | undefined>();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EvalTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!generationId) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const resp = await ds.testEval({
        kind,
        config,
        output_keys: outputKeys,
        generation_id: generationId,
      });
      setResult(resp);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setRunning(false);
    }
  };

  if (!expanded) {
    return (
      <Button variant="secondary" icon="play" size="sm" onClick={() => setExpanded(true)}>
        Test
      </Button>
    );
  }

  return (
    <div className={styles.panel}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Text weight="medium">Quick Test</Text>
        <Button variant="secondary" size="sm" icon="times" onClick={() => setExpanded(false)} />
      </Stack>

      <GenerationPicker onSelect={setGenerationId} selectedGenerationId={generationId} />

      <Stack direction="row" gap={1} alignItems="center">
        <Button
          onClick={handleRun}
          disabled={!generationId || running}
          icon={running ? undefined : 'play'}
        >
          {running ? <Spinner inline /> : 'Run Test'}
        </Button>
        {generationId && (
          <Text variant="bodySmall" color="secondary">
            Selected: {generationId}
          </Text>
        )}
      </Stack>

      {error && <Alert severity="error" title="Test failed">{error}</Alert>}
      {result && <TestResultDisplay result={result} />}
    </div>
  );
}
```

**Step 1: Create the component file**
**Step 2: Verify types**

Run: `mise run check`

**Step 3: Commit**

```bash
git add apps/plugin/src/components/evaluation/EvalTestPanel.tsx
git commit -m "feat(plugin): add EvalTestPanel component"
```

---

### Task 10: Integrate EvalTestPanel into EvaluatorForm

**Files:**
- Modify: `apps/plugin/src/components/evaluation/EvaluatorForm.tsx`

**Step 1: Add EvalTestPanel below the output key field, before the submit buttons**

Import `EvalTestPanel` and add it to the JSX between the output key field and the button stack:

```tsx
import EvalTestPanel from './EvalTestPanel';

// Inside the return, before the Stack with Create/Cancel buttons:
<EvalTestPanel kind={kind} config={buildConfig()} outputKeys={[{ key: outputKey.trim() || 'score', type: outputType }]} />
```

**Step 2: Verify types and UI**

Run: `mise run check`

**Step 3: Commit**

```bash
git add apps/plugin/src/components/evaluation/EvaluatorForm.tsx
git commit -m "feat(plugin): integrate EvalTestPanel into EvaluatorForm"
```

---

### Task 11: Format, lint, and verify

**Step 1: Format**

Run: `mise run format`

**Step 2: Lint**

Run: `mise run lint`

**Step 3: Type check**

Run: `mise run check`

**Step 4: Run Go tests**

Run: `go test ./sigil/internal/eval/... -v`

**Step 5: Fix any issues, commit**

```bash
git add -A
git commit -m "chore: format and lint"
```

---

## Reference: Key Files

| Purpose | File | Key lines |
|---|---|---|
| Evaluator interface | `sigil/internal/eval/evaluators/interface.go` | `Evaluator` interface, `InputFromGeneration`, `EvalInput`, `ScoreOutput` |
| Worker evaluator registry | `sigil/internal/eval/worker/service.go:111-116` | Map of kind → evaluator |
| GenerationReader interface | `sigil/internal/eval/worker/service.go:34-36` | `GetByID(ctx, tenantID, generationID)` |
| HotCold reader | `sigil/internal/eval/worker/reader.go:15` | `NewHotColdGenerationReader` |
| Control Service | `sigil/internal/eval/control/service.go:39-47` | `Service` struct |
| Validation helpers | `sigil/internal/eval/control/service.go:49-75` | `validationError`, `newValidationError`, `isValidationError` |
| Kind + output key validators | `sigil/internal/eval/control/templates.go:332-356` | `validateKind`, `validateOutputKeys` |
| HTTP helpers | `sigil/internal/eval/control/http.go:339-441` | `decodeJSONBody`, `writeJSON`, `writeControlWriteError`, `tenantIDFromRequest` |
| Route registration | `sigil/internal/eval/control/http.go:44-66` | `RegisterHTTPRoutes` |
| Querier wiring | `sigil/internal/querier_module.go:109-194` | Control service creation, route registration |
| Plugin proxy | `apps/plugin/pkg/plugin/resources.go:484-486` | `handleEvalRulesPreview` pattern |
| Eval API client | `apps/plugin/src/evaluation/api.ts:20-35` | `EvaluationDataSource` interface |
| Conversation API | `apps/plugin/src/conversation/api.ts:24-31` | `ConversationsDataSource` interface |
| Eval types | `apps/plugin/src/evaluation/types.ts` | All eval TS types |
| Conversation types | `apps/plugin/src/conversation/types.ts` | Search/detail types |
| Generation types | `apps/plugin/src/generation/types.ts:53-74` | `GenerationDetail` |
| EvaluatorForm | `apps/plugin/src/components/evaluation/EvaluatorForm.tsx` | Form to integrate test panel into |
