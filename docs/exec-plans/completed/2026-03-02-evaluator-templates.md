# Evaluator Templates Implementation Plan

**Goal:** Add tenant-managed evaluator templates as a first-class resource with versioning, forking with lineage, and backwards-compatible migration of existing predefined templates.

**Architecture:** New `eval_templates` and `eval_template_versions` tables with GORM models. New `TemplateStore` interface and MySQL implementation. New HTTP endpoints under `/api/v1/eval/templates`. Existing predefined endpoints become proxies over the templates table. Evaluators gain `source_template_id` and `source_template_version` lineage fields.

**Tech Stack:** Go 1.25.6, GORM (MySQL), httptest, testcontainers-go

**Design doc:** `docs/design-docs/2026-03-02-evaluator-templates.md`

---

### Task 1: Add template domain types

**Files:**
- Modify: `sigil/internal/eval/types.go`

**Step 1: Write the types**

Add after the existing `RuleDefinition` struct (around line 103):

```go
// TemplateScope controls visibility of a template.
type TemplateScope string

const (
	TemplateScopeGlobal TemplateScope = "global"
	TemplateScopeTenant TemplateScope = "tenant"
)

// TemplateDefinition is a reusable, versioned evaluator blueprint.
type TemplateDefinition struct {
	TenantID      string        `json:"tenant_id"`
	TemplateID    string        `json:"template_id"`
	Scope         TemplateScope `json:"scope"`
	LatestVersion string        `json:"latest_version"`
	Kind          EvaluatorKind `json:"kind"`
	Description   string        `json:"description,omitempty"`
	DeletedAt     *time.Time    `json:"deleted_at,omitempty"`
	CreatedAt     time.Time     `json:"created_at"`
	UpdatedAt     time.Time     `json:"updated_at"`
}

// TemplateVersion is an immutable snapshot of a template's config.
type TemplateVersion struct {
	TenantID   string         `json:"tenant_id"`
	TemplateID string         `json:"template_id"`
	Version    string         `json:"version"`
	Config     map[string]any `json:"config"`
	OutputKeys []OutputKey    `json:"output_keys"`
	Changelog  string         `json:"changelog,omitempty"`
	CreatedAt  time.Time      `json:"created_at"`
}
```

**Step 2: Add TemplateStore interface**

Add after the existing `EvalStore` interface (around line 181):

```go
// TemplateStore manages evaluator template CRUD and versioning.
type TemplateStore interface {
	CreateTemplate(ctx context.Context, tmpl TemplateDefinition, version TemplateVersion) error
	GetTemplate(ctx context.Context, tenantID, templateID string) (*TemplateDefinition, error)
	GetGlobalTemplate(ctx context.Context, templateID string) (*TemplateDefinition, error)
	ListTemplates(ctx context.Context, tenantID string, scope *TemplateScope, limit int, cursor uint64) ([]TemplateDefinition, uint64, error)
	DeleteTemplate(ctx context.Context, tenantID, templateID string) error
	CountActiveTemplates(ctx context.Context, tenantID string) (int64, error)

	CreateTemplateVersion(ctx context.Context, version TemplateVersion) error
	GetTemplateVersion(ctx context.Context, tenantID, templateID, version string) (*TemplateVersion, error)
	GetLatestTemplateVersion(ctx context.Context, tenantID, templateID string) (*TemplateVersion, error)
	ListTemplateVersions(ctx context.Context, tenantID, templateID string) ([]TemplateVersion, error)

	UpdateTemplateLatestVersion(ctx context.Context, tenantID, templateID, version string) error
}
```

**Step 3: Add lineage fields to EvaluatorDefinition**

Modify the existing `EvaluatorDefinition` struct:

```go
type EvaluatorDefinition struct {
	TenantID              string         `json:"tenant_id"`
	EvaluatorID           string         `json:"evaluator_id"`
	Version               string         `json:"version"`
	Kind                  EvaluatorKind  `json:"kind"`
	Config                map[string]any `json:"config"`
	OutputKeys            []OutputKey    `json:"output_keys"`
	IsPredefined          bool           `json:"is_predefined"`
	SourceTemplateID      string         `json:"source_template_id,omitempty"`
	SourceTemplateVersion string         `json:"source_template_version,omitempty"`
	DeletedAt             *time.Time     `json:"deleted_at,omitempty"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
}
```

**Step 4: Run existing tests to verify no breakage**

Run: `cd sigil && go test ./internal/eval/...`
Expected: All existing tests PASS (new fields are omitempty, no behavior change)

**Step 5: Commit**

```bash
git add sigil/internal/eval/types.go
git commit -m "feat(eval): add template domain types, TemplateStore interface, and evaluator lineage fields"
```

---

### Task 2: Add GORM models and auto-migration

**Files:**
- Modify: `sigil/internal/storage/mysql/models.go`
- Modify: `sigil/internal/storage/mysql/migrate.go`

**Step 1: Add GORM models to models.go**

Add after the existing `EvalRuleModel` (around line 128):

```go
type EvalTemplateModel struct {
	ID            uint64     `gorm:"primaryKey;autoIncrement"`
	TenantID      string     `gorm:"size:128;not null;uniqueIndex:ux_eval_templates_tenant_id,priority:1"`
	TemplateID    string     `gorm:"size:255;not null;uniqueIndex:ux_eval_templates_tenant_id,priority:2"`
	Scope         string     `gorm:"size:32;not null;default:tenant"`
	LatestVersion string     `gorm:"size:64;not null"`
	Kind          string     `gorm:"size:32;not null"`
	Description   *string    `gorm:"type:text"`
	DeletedAt     *time.Time `gorm:"type:datetime(6)"`
	CreatedAt     time.Time  `gorm:"type:datetime(6);not null;autoCreateTime"`
	UpdatedAt     time.Time  `gorm:"type:datetime(6);not null;autoUpdateTime"`
}

func (EvalTemplateModel) TableName() string { return "eval_templates" }

type EvalTemplateVersionModel struct {
	ID             uint64    `gorm:"primaryKey;autoIncrement"`
	TenantID       string    `gorm:"size:128;not null;uniqueIndex:ux_eval_template_versions_tenant_id_version,priority:1"`
	TemplateID     string    `gorm:"size:255;not null;uniqueIndex:ux_eval_template_versions_tenant_id_version,priority:2"`
	Version        string    `gorm:"size:64;not null;uniqueIndex:ux_eval_template_versions_tenant_id_version,priority:3"`
	ConfigJSON     string    `gorm:"type:json;not null"`
	OutputKeysJSON string    `gorm:"type:json;not null"`
	Changelog      *string   `gorm:"type:text"`
	CreatedAt      time.Time `gorm:"type:datetime(6);not null;autoCreateTime"`
}

func (EvalTemplateVersionModel) TableName() string { return "eval_template_versions" }
```

**Step 2: Add lineage columns to EvalEvaluatorModel**

Modify the existing `EvalEvaluatorModel`:

```go
// Add these two fields after IsPredefined:
SourceTemplateID      *string `gorm:"size:255"`
SourceTemplateVersion *string `gorm:"size:64"`
```

**Step 3: Register models in AutoMigrate**

In `migrate.go`, add `&EvalTemplateModel{}` and `&EvalTemplateVersionModel{}` to the `AutoMigrate()` call.

**Step 4: Run migration test**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestAutoMigrate -v -count=1`
Expected: PASS (GORM creates the new tables)

**Step 5: Commit**

```bash
git add sigil/internal/storage/mysql/models.go sigil/internal/storage/mysql/migrate.go
git commit -m "feat(storage): add eval_templates and eval_template_versions GORM models"
```

---

### Task 3: Implement MySQL TemplateStore

**Files:**
- Create: `sigil/internal/storage/mysql/eval_templates.go`
- Create: `sigil/internal/storage/mysql/eval_templates_test.go`

**Step 1: Write the failing test**

Create `eval_templates_test.go` following the existing pattern in `eval_test.go`. Use `newTestWALStore(t)` and `store.AutoMigrate()`:

```go
func TestTemplateStoreCRUD(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()
	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	ctx := context.Background()
	tenantID := "test-tenant"

	// Create template with initial version
	tmpl := evalpkg.TemplateDefinition{
		TenantID:      tenantID,
		TemplateID:    "test.helpfulness",
		Scope:         evalpkg.TemplateScopeTenant,
		LatestVersion: "2026-03-02",
		Kind:          evalpkg.EvaluatorKindLLMJudge,
		Description:   "Test helpfulness template",
	}
	version := evalpkg.TemplateVersion{
		TenantID:   tenantID,
		TemplateID: "test.helpfulness",
		Version:    "2026-03-02",
		Config:     map[string]any{"provider": "anthropic", "model": "haiku"},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
		Changelog:  "Initial version",
	}

	err := store.CreateTemplate(ctx, tmpl, version)
	require.NoError(t, err)

	// Get template
	got, err := store.GetTemplate(ctx, tenantID, "test.helpfulness")
	require.NoError(t, err)
	require.Equal(t, "test.helpfulness", got.TemplateID)
	require.Equal(t, "2026-03-02", got.LatestVersion)

	// Get version
	gotVersion, err := store.GetTemplateVersion(ctx, tenantID, "test.helpfulness", "2026-03-02")
	require.NoError(t, err)
	require.Equal(t, "anthropic", gotVersion.Config["provider"])

	// List templates (should include tenant)
	templates, _, err := store.ListTemplates(ctx, tenantID, nil, 50, 0)
	require.NoError(t, err)
	require.Len(t, templates, 1)

	// Publish new version
	v2 := evalpkg.TemplateVersion{
		TenantID:   tenantID,
		TemplateID: "test.helpfulness",
		Version:    "2026-03-03",
		Config:     map[string]any{"provider": "openai", "model": "gpt-4o-mini"},
		OutputKeys: []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
		Changelog:  "Switched to OpenAI",
	}
	err = store.CreateTemplateVersion(ctx, v2)
	require.NoError(t, err)
	err = store.UpdateTemplateLatestVersion(ctx, tenantID, "test.helpfulness", "2026-03-03")
	require.NoError(t, err)

	// Verify latest version updated
	got, err = store.GetTemplate(ctx, tenantID, "test.helpfulness")
	require.NoError(t, err)
	require.Equal(t, "2026-03-03", got.LatestVersion)

	// List versions
	versions, err := store.ListTemplateVersions(ctx, tenantID, "test.helpfulness")
	require.NoError(t, err)
	require.Len(t, versions, 2)

	// Delete template (soft)
	err = store.DeleteTemplate(ctx, tenantID, "test.helpfulness")
	require.NoError(t, err)

	got, err = store.GetTemplate(ctx, tenantID, "test.helpfulness")
	require.Nil(t, got)
}
```

**Step 2: Run test to verify it fails**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestTemplateStoreCRUD -v -count=1`
Expected: FAIL (methods not implemented)

**Step 3: Implement the store methods in `eval_templates.go`**

Follow the same patterns as `eval.go`: model ↔ domain conversion functions, GORM queries with `WHERE deleted_at IS NULL`, pagination by `id ASC`, JSON marshal/unmarshal for config and output keys.

Key method: `ListTemplates` should return both tenant templates AND global templates (`scope = 'global'`):
```go
query := s.db.WithContext(ctx).Where(
	"(tenant_id = ? OR scope = ?) AND deleted_at IS NULL",
	tenantID, string(evalpkg.TemplateScopeGlobal),
)
```

**Step 4: Run test to verify it passes**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestTemplateStoreCRUD -v -count=1`
Expected: PASS

**Step 5: Add edge case tests**

Add tests for:
- Global template visibility (create with `scope=global`, list from a different tenant, verify it appears)
- Duplicate template ID (same tenant, expect upsert or error)
- Duplicate version (same template, expect error)
- Scope filter on list (pass `scope=tenant` to exclude globals)
- Delete nonexistent template (idempotent, no error)

**Step 6: Run full test suite**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestTemplateStore -v -count=1`
Expected: All PASS

**Step 7: Commit**

```bash
git add sigil/internal/storage/mysql/eval_templates.go sigil/internal/storage/mysql/eval_templates_test.go
git commit -m "feat(storage): implement MySQL TemplateStore with CRUD and versioning"
```

---

### Task 4: Add evaluator lineage to storage layer

**Files:**
- Modify: `sigil/internal/storage/mysql/eval.go`
- Modify: `sigil/internal/storage/mysql/eval_test.go`

**Step 1: Write the failing test**

Add a test to `eval_test.go`:

```go
func TestEvalStoreEvaluatorLineage(t *testing.T) {
	store, cleanup := newTestWALStore(t)
	defer cleanup()
	if err := store.AutoMigrate(context.Background()); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	ctx := context.Background()
	tenantID := "test-tenant"

	eval := evalpkg.EvaluatorDefinition{
		TenantID:              tenantID,
		EvaluatorID:           "forked.helpfulness",
		Version:               "2026-03-02",
		Kind:                  evalpkg.EvaluatorKindLLMJudge,
		Config:                map[string]any{"provider": "anthropic"},
		OutputKeys:            []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
		SourceTemplateID:      "sigil.helpfulness",
		SourceTemplateVersion: "2026-02-17",
	}
	err := store.CreateEvaluator(ctx, eval)
	require.NoError(t, err)

	got, err := store.GetEvaluator(ctx, tenantID, "forked.helpfulness")
	require.NoError(t, err)
	require.Equal(t, "sigil.helpfulness", got.SourceTemplateID)
	require.Equal(t, "2026-02-17", got.SourceTemplateVersion)
}
```

**Step 2: Run test to verify it fails**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestEvalStoreEvaluatorLineage -v -count=1`
Expected: FAIL (lineage fields not mapped)

**Step 3: Update model ↔ domain conversion**

In `eval.go`, update `evaluatorToModel()` and `modelToEvaluator()` to map `SourceTemplateID` and `SourceTemplateVersion` to/from the nullable model fields.

**Step 4: Run test to verify it passes**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestEvalStoreEvaluatorLineage -v -count=1`
Expected: PASS

**Step 5: Run full eval storage tests**

Run: `cd sigil && go test ./internal/storage/mysql/ -run TestEvalStore -v -count=1`
Expected: All existing tests still PASS

**Step 6: Commit**

```bash
git add sigil/internal/storage/mysql/eval.go sigil/internal/storage/mysql/eval_test.go
git commit -m "feat(storage): add evaluator lineage fields to storage layer"
```

---

### Task 5: Template service layer

**Files:**
- Create: `sigil/internal/eval/control/templates.go`
- Create: `sigil/internal/eval/control/templates_test.go`

**Step 1: Write the failing test for template creation**

Use the same in-memory mock pattern as `http_test.go`. Create a `memoryTemplateStore` that implements `TemplateStore` in-memory. Then test the service:

```go
func TestTemplateService_Create(t *testing.T) {
	store := newMemoryTemplateStore()
	svc := NewTemplateService(store)

	tmpl, err := svc.CreateTemplate(context.Background(), "test-tenant", CreateTemplateRequest{
		TemplateID:  "my.helpfulness",
		Kind:        "llm_judge",
		Description: "Custom helpfulness check",
		Version:     "2026-03-02",
		Config:      map[string]any{"provider": "anthropic"},
		OutputKeys:  []evalpkg.OutputKey{{Key: "helpfulness", Type: evalpkg.ScoreTypeNumber}},
		Changelog:   "Initial",
	})
	require.NoError(t, err)
	require.Equal(t, "my.helpfulness", tmpl.TemplateID)
	require.Equal(t, evalpkg.TemplateScopeTenant, tmpl.Scope)
	require.Equal(t, "2026-03-02", tmpl.LatestVersion)
}
```

**Step 2: Run test to verify it fails**

Run: `cd sigil && go test ./internal/eval/control/ -run TestTemplateService_Create -v -count=1`
Expected: FAIL

**Step 3: Implement TemplateService**

Create `templates.go` with:

```go
type TemplateService struct {
	store evalpkg.TemplateStore
}

func NewTemplateService(store evalpkg.TemplateStore) *TemplateService {
	return &TemplateService{store: store}
}

type CreateTemplateRequest struct {
	TemplateID  string             `json:"template_id"`
	Kind        string             `json:"kind"`
	Description string             `json:"description,omitempty"`
	Version     string             `json:"version"`
	Config      map[string]any     `json:"config"`
	OutputKeys  []evalpkg.OutputKey `json:"output_keys"`
	Changelog   string             `json:"changelog,omitempty"`
}
```

Implement methods:
- `CreateTemplate` — validates fields, sets `scope = tenant`, creates template + initial version in store.
- `GetTemplate` — resolves tenant first, then global fallback.
- `ListTemplates` — returns tenant + global, paginated.
- `DeleteTemplate` — only tenant templates, not global.
- `PublishVersion` — validates version format (date-based), creates version, updates latest pointer.
- `GetTemplateVersion` / `ListTemplateVersions` — pass-through to store.
- `ForkTemplate` — loads template version, shallow-merges config overrides, calls `evalService.CreateEvaluator` with lineage fields.

Validation:
- `template_id` required, trimmed.
- `kind` must be valid `EvaluatorKind`, immutable after creation.
- `version` must match `YYYY-MM-DD` or `YYYY-MM-DD.N` format.
- `config` required, non-empty.
- `output_keys` required, exactly one.
- Users cannot create `scope = global` templates.

**Step 4: Run test to verify it passes**

Run: `cd sigil && go test ./internal/eval/control/ -run TestTemplateService_Create -v -count=1`
Expected: PASS

**Step 5: Add more service tests**

Test cases:
- Create with invalid kind → validation error
- Create with invalid version format → validation error
- Create duplicate template_id → error
- Publish new version → latest_version advances
- Publish duplicate version → error
- Fork template → evaluator created with lineage fields
- Fork with config overrides → merged config
- Fork nonexistent template → error
- Delete template → soft-deleted, no longer listed
- Delete global template → error (forbidden)
- List includes both tenant and global templates
- Get resolves tenant before global (tenant shadows global)

**Step 6: Run all service tests**

Run: `cd sigil && go test ./internal/eval/control/ -run TestTemplateService -v -count=1`
Expected: All PASS

**Step 7: Commit**

```bash
git add sigil/internal/eval/control/templates.go sigil/internal/eval/control/templates_test.go
git commit -m "feat(eval): implement template service with create, version, fork, and validation"
```

---

### Task 6: Template HTTP handlers

**Files:**
- Create: `sigil/internal/eval/control/http_templates.go`
- Create: `sigil/internal/eval/control/http_templates_test.go`
- Modify: `sigil/internal/eval/control/http.go` (route registration)

**Step 1: Write the failing HTTP test**

Follow the pattern in `http_test.go` — use `httptest`, `doRequest()` helper, and memory stores:

```go
func TestTemplateHTTP_CreateAndList(t *testing.T) {
	store := newMemoryTemplateStore()
	evalStore := newMemoryControlStore()
	svc := NewTemplateService(store)
	evalSvc := NewService(evalStore, nil)
	mux := newTemplateMux(svc, evalSvc)

	// Create template
	createResp := doRequest(mux, http.MethodPost, "/api/v1/eval/templates", `{
		"template_id": "my.helpfulness",
		"kind": "llm_judge",
		"description": "Test",
		"version": "2026-03-02",
		"config": {"provider": "anthropic"},
		"output_keys": [{"key": "helpfulness", "type": "number"}]
	}`)
	require.Equal(t, http.StatusOK, createResp.Code)

	// List templates
	listResp := doRequest(mux, http.MethodGet, "/api/v1/eval/templates", "")
	require.Equal(t, http.StatusOK, listResp.Code)
	var listBody struct{ Items []any }
	json.Unmarshal(listResp.Body.Bytes(), &listBody)
	require.Len(t, listBody.Items, 1)
}
```

**Step 2: Run test to verify it fails**

Run: `cd sigil && go test ./internal/eval/control/ -run TestTemplateHTTP -v -count=1`
Expected: FAIL

**Step 3: Implement HTTP handlers in `http_templates.go`**

Follow the pattern from `http.go`:

```go
func (s *TemplateService) handleTemplates(w http.ResponseWriter, req *http.Request) {
	switch req.Method {
	case http.MethodGet:
		// List templates (tenant + global)
	case http.MethodPost:
		// Create template
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *TemplateService) handleTemplateByID(w http.ResponseWriter, req *http.Request) {
	// GET /{id} — get template with latest version config
	// DELETE /{id} — soft-delete
	// POST /{id}:fork — fork into evaluator
}

func (s *TemplateService) handleTemplateVersions(w http.ResponseWriter, req *http.Request) {
	// GET /{id}/versions — list versions
	// POST /{id}/versions — publish new version
}

func (s *TemplateService) handleTemplateVersionByID(w http.ResponseWriter, req *http.Request) {
	// GET /{id}/versions/{version} — get specific version
}
```

**Step 4: Register routes in `http.go`**

Add to `RegisterHTTPRoutes()`:

```go
// Templates: CRUD + versions + fork
mux.Handle("/api/v1/eval/templates", protectedMiddleware(http.HandlerFunc(templateService.handleTemplates)))
mux.Handle("/api/v1/eval/templates/", protectedMiddleware(http.HandlerFunc(templateService.routeTemplateSubpaths)))
```

Where `routeTemplateSubpaths` dispatches based on path depth:
- `/api/v1/eval/templates/{id}` → `handleTemplateByID`
- `/api/v1/eval/templates/{id}/versions` → `handleTemplateVersions`
- `/api/v1/eval/templates/{id}/versions/{v}` → `handleTemplateVersionByID`
- `/api/v1/eval/templates/{id}:fork` → fork handler

**Step 5: Run test to verify it passes**

Run: `cd sigil && go test ./internal/eval/control/ -run TestTemplateHTTP -v -count=1`
Expected: PASS

**Step 6: Add full HTTP test coverage**

Test cases:
- POST create → 200 with template body
- POST create with bad kind → 400
- POST create with bad version format → 400
- GET list → 200 with items + next_cursor
- GET list with scope filter → only matching scope
- GET by ID → 200 with config from latest version
- GET nonexistent → 404
- DELETE → 204
- DELETE global → 403
- POST /{id}/versions → 200, latest_version advances
- POST /{id}/versions with duplicate version → 400
- GET /{id}/versions → 200, ordered newest first
- GET /{id}/versions/{v} → 200
- POST /{id}:fork → 200, evaluator created with lineage
- POST /{id}:fork with config overrides → merged config
- POST /{id}:fork nonexistent → 404

**Step 7: Run all HTTP tests**

Run: `cd sigil && go test ./internal/eval/control/ -run TestTemplateHTTP -v -count=1`
Expected: All PASS

**Step 8: Commit**

```bash
git add sigil/internal/eval/control/http_templates.go sigil/internal/eval/control/http_templates_test.go sigil/internal/eval/control/http.go
git commit -m "feat(eval): add template HTTP handlers with CRUD, versioning, and fork endpoints"
```

---

### Task 7: Migrate predefined templates to templates table

**Files:**
- Modify: `sigil/internal/eval/control/service.go`
- Create: `sigil/internal/eval/control/bootstrap.go`
- Create: `sigil/internal/eval/control/bootstrap_test.go`

**Step 1: Write the failing test**

```go
func TestBootstrapPredefinedTemplates(t *testing.T) {
	templateStore := newMemoryTemplateStore()
	err := BootstrapPredefinedTemplates(context.Background(), templateStore)
	require.NoError(t, err)

	// Verify all 11 predefined templates were created as global
	templates, _, err := templateStore.ListTemplates(context.Background(), "__any__", nil, 100, 0)
	require.NoError(t, err)

	globalCount := 0
	for _, tmpl := range templates {
		if tmpl.Scope == evalpkg.TemplateScopeGlobal {
			globalCount++
		}
	}
	require.Equal(t, len(predefined.Templates()), globalCount)

	// Verify idempotency — run again, same count
	err = BootstrapPredefinedTemplates(context.Background(), templateStore)
	require.NoError(t, err)
}
```

**Step 2: Run test to verify it fails**

Run: `cd sigil && go test ./internal/eval/control/ -run TestBootstrapPredefinedTemplates -v -count=1`
Expected: FAIL

**Step 3: Implement bootstrap**

Create `bootstrap.go`:

```go
const GlobalTenantID = "global"

func BootstrapPredefinedTemplates(ctx context.Context, store evalpkg.TemplateStore) error {
	for _, def := range predefined.Templates() {
		tmpl := evalpkg.TemplateDefinition{
			TenantID:      GlobalTenantID,
			TemplateID:    def.EvaluatorID,
			Scope:         evalpkg.TemplateScopeGlobal,
			LatestVersion: def.Version,
			Kind:          def.Kind,
		}
		version := evalpkg.TemplateVersion{
			TenantID:   GlobalTenantID,
			TemplateID: def.EvaluatorID,
			Version:    def.Version,
			Config:     def.Config,
			OutputKeys: def.OutputKeys,
			Changelog:  "Predefined template",
		}
		// Idempotent: skip if already exists
		existing, _ := store.GetGlobalTemplate(ctx, def.EvaluatorID)
		if existing != nil {
			continue
		}
		if err := store.CreateTemplate(ctx, tmpl, version); err != nil {
			return fmt.Errorf("bootstrap template %s: %w", def.EvaluatorID, err)
		}
	}
	return nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd sigil && go test ./internal/eval/control/ -run TestBootstrapPredefinedTemplates -v -count=1`
Expected: PASS

**Step 5: Commit**

```bash
git add sigil/internal/eval/control/bootstrap.go sigil/internal/eval/control/bootstrap_test.go
git commit -m "feat(eval): bootstrap predefined templates into templates table on startup"
```

---

### Task 8: Redirect predefined endpoints to templates table

**Files:**
- Modify: `sigil/internal/eval/control/service.go`
- Modify: `sigil/internal/eval/control/http_test.go`

**Step 1: Write the failing test**

Update the existing predefined tests in `http_test.go` to verify they still work after the switch:

```go
func TestPredefinedEndpoints_BackwardsCompatible(t *testing.T) {
	templateStore := newMemoryTemplateStore()
	err := BootstrapPredefinedTemplates(context.Background(), templateStore)
	require.NoError(t, err)

	evalStore := newMemoryControlStore()
	evalSvc := NewService(evalStore, nil)
	tmplSvc := NewTemplateService(templateStore)
	mux := newEvalMuxWithTemplates(evalSvc, tmplSvc)

	// GET /api/v1/eval/predefined/evaluators — should return all 11
	listResp := doRequest(mux, http.MethodGet, "/api/v1/eval/predefined/evaluators", "")
	require.Equal(t, http.StatusOK, listResp.Code)
	var listBody struct{ Items []map[string]any }
	json.Unmarshal(listResp.Body.Bytes(), &listBody)
	require.Equal(t, len(predefined.Templates()), len(listBody.Items))

	// POST /api/v1/eval/predefined/evaluators/sigil.helpfulness:fork — should work
	forkResp := doRequest(mux, http.MethodPost,
		"/api/v1/eval/predefined/evaluators/sigil.helpfulness:fork",
		`{"evaluator_id":"custom.helpfulness"}`)
	require.Equal(t, http.StatusOK, forkResp.Code)

	// Verify forked evaluator has lineage
	var forkBody map[string]any
	json.Unmarshal(forkResp.Body.Bytes(), &forkBody)
	require.Equal(t, "sigil.helpfulness", forkBody["source_template_id"])
}
```

**Step 2: Run test to verify it fails**

Run: `cd sigil && go test ./internal/eval/control/ -run TestPredefinedEndpoints_BackwardsCompatible -v -count=1`
Expected: FAIL

**Step 3: Update predefined handlers**

In `service.go`, change `ListPredefinedEvaluators` to read from templates table (global scope) instead of `predefined.Templates()`. Change `ForkPredefinedEvaluator` to load the template version from the store and set lineage fields on the created evaluator.

The response shape stays identical — convert `TemplateDefinition` + `TemplateVersion` back to the `EvaluatorDefinition` shape that the predefined list returns today.

**Step 4: Run test to verify it passes**

Run: `cd sigil && go test ./internal/eval/control/ -run TestPredefinedEndpoints_BackwardsCompatible -v -count=1`
Expected: PASS

**Step 5: Run ALL existing tests**

Run: `cd sigil && go test ./internal/eval/... -v -count=1`
Expected: All existing tests PASS — no behavioral changes to existing endpoints.

**Step 6: Commit**

```bash
git add sigil/internal/eval/control/service.go sigil/internal/eval/control/http_test.go
git commit -m "refactor(eval): redirect predefined endpoints to templates table, backwards compatible"
```

---

### Task 9: Wire templates into the application runtime

**Files:**
- Modify: `sigil/internal/sigil.go` (or wherever modules are wired)
- Modify: `sigil/internal/server/http.go` (if route registration happens here)

**Step 1: Find the wiring point**

Check how the eval control service is constructed and registered. The `TemplateStore` needs to be created from the MySQL WAL store, the `TemplateService` constructed, bootstrap called, and routes registered.

**Step 2: Wire TemplateStore and TemplateService**

- Create `TemplateStore` from the WAL store (the WAL store implements both `EvalStore` and `TemplateStore` since we added methods to it)
- Create `TemplateService`
- Call `BootstrapPredefinedTemplates` during startup
- Pass `TemplateService` to `RegisterHTTPRoutes`

**Step 3: Test manually**

Start the stack: `mise run up`

Verify:
```bash
# New templates endpoint lists global templates
curl -s http://localhost:8080/api/v1/eval/templates | jq '.items | length'
# Expected: 11 (predefined templates bootstrapped)

# Old predefined endpoint still works
curl -s http://localhost:8080/api/v1/eval/predefined/evaluators | jq '.items | length'
# Expected: 11

# Create a tenant template
curl -s -X POST http://localhost:8080/api/v1/eval/templates \
  -H "Content-Type: application/json" \
  -d '{
    "template_id": "my.policy-check",
    "kind": "llm_judge",
    "version": "2026-03-02",
    "description": "Policy compliance checker",
    "config": {"provider": "anthropic", "model": "claude-haiku-4-5-20251001", "system_prompt": "...", "user_prompt": "...", "max_tokens": 256, "temperature": 0},
    "output_keys": [{"key": "policy_compliance", "type": "bool"}]
  }' | jq

# Fork the tenant template
curl -s -X POST http://localhost:8080/api/v1/eval/templates/my.policy-check:fork \
  -H "Content-Type: application/json" \
  -d '{"evaluator_id": "prod.policy-check"}' | jq '.source_template_id'
# Expected: "my.policy-check"
```

**Step 4: Commit**

```bash
git add sigil/internal/sigil.go sigil/internal/server/http.go
git commit -m "feat(eval): wire template service into application runtime with bootstrap"
```

---

### Task 10: Update eval-setup.sh and documentation

**Files:**
- Modify: `.config/devex/eval-setup.sh`
- Modify: `docs/design-docs/2026-03-02-evaluator-templates.md` (status → active)
- Modify: `WIP.md` (update with template API examples)

**Step 1: Update eval-setup.sh**

Add a `--from-template` option to the `create` command that uses the new templates API instead of the predefined fork endpoint. Keep the existing predefined fork as default for backwards compatibility.

**Step 2: Update design doc status**

Change frontmatter `status: draft` → `status: active`.

**Step 3: Update WIP.md**

Add template API curl examples to the working doc.

**Step 4: Commit**

```bash
git add .config/devex/eval-setup.sh docs/design-docs/2026-03-02-evaluator-templates.md
git commit -m "docs: update eval-setup script and design doc for template support"
```

---

## Task Dependency Graph

```
Task 1 (types) ──→ Task 2 (GORM models) ──→ Task 3 (MySQL store) ──→ Task 5 (service) ──→ Task 6 (HTTP) ──→ Task 8 (predefined redirect) ──→ Task 9 (wiring)
                                          ╰──→ Task 4 (lineage)   ╯                     ╰──→ Task 7 (bootstrap) ╯                           ╰──→ Task 10 (docs)
```

Tasks 3 and 4 can run in parallel. Tasks 7 and 8 depend on both 5/6.
