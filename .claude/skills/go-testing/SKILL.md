---
name: go-testing
description: Use when writing or reviewing Go tests — covers table-driven tests, moq mocking, testcontainers, httptest, and project-specific helpers.
---

# Go Testing Standards

Tests are a design feedback mechanism. If testing is painful, the code has a design problem — listen to that signal.

## Table-Driven Tests Are the Default

Use `for _, tt := range tests` with `t.Run` for every function with multiple cases. Split the function under test when the test table grows unwieldy.

```go
tests := []struct {
    name    string
    input   InputType
    want    OutputType
    wantErr string
}{
    {name: "success case", input: validInput, want: expectedOutput},
    {name: "invalid input", input: invalidInput, wantErr: "is required"},
}
for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        got, err := FunctionUnderTest(tt.input)
        if tt.wantErr != "" {
            if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
                t.Errorf("expected error containing %q, got %v", tt.wantErr, err)
            }
            return
        }
        if err != nil {
            t.Fatalf("unexpected error: %v", err)
        }
        if got != tt.want {
            t.Errorf("got %v, want %v", got, tt.want)
        }
    })
}
```

## Assertions: stdlib t.Fatalf / t.Errorf

Use `t.Fatalf` to stop on precondition failures, `t.Errorf` to continue and show all failures.

```go
// Precondition — stop immediately if this fails
if err != nil {
    t.Fatalf("setup failed: %v", err)
}

// Verification — show the failure
if got != want {
    t.Errorf("got %v, want %v", got, want)
}
```

## Mocking with moq

Use [moq](https://github.com/matryer/moq) for all generated mocks. Mocks are func-field structs. Generate via `mise run generate:mocks`. Name generated files `mock.gen.go` (exported) or `*_mock_test.gen.go` (test-only).

```go
// Assign func fields inline — stub only what the test exercises
store := &StoreMock{
    GetFunc: func(ctx context.Context, id string) (*Widget, error) {
        return &Widget{ID: id, Name: "test"}, nil
    },
    // Unstubbed methods panic on call, catching unexpected interactions
}

// Verify calls
if len(store.GetCalls()) != 1 {
    t.Fatalf("expected 1 Get call, got %d", len(store.GetCalls()))
}
```

**Guidelines:**
- Use moq-generated mocks for all new test code.
- Stub only the methods the test exercises — unstubbed methods panic, catching unexpected calls.
- Keep dependencies to 2-3 per function. More means the function needs refactoring.
- Add every new mock generation command to `mise run generate:mocks` in `mise.toml`.

**Generating mocks:**

All `moq` commands run from the repo root. Paths are relative to the root, not the module.

```bash
# Generate all mocks across all modules
mise run generate:mocks

# Generate mocks for a single module
mise run generate:mocks:sigil
mise run generate:mocks:plugin
mise run generate:mocks:sdk-go
mise run generate:mocks:sdk-go-providers
mise run generate:mocks:sdk-go-frameworks

# One-off example (then register in the module's mise task)
moq -rm -out ./<module>/path/to/mock_test.gen.go ./<module>/path/to/package InterfaceName

# Cross-package mock (set correct package with -pkg)
moq -rm -pkg <consumer_pkg> -out ./<module>/path/to/mock_test.gen.go ./<module>/path/to/source SourceInterface
```

**Naming convention:**

| Scenario | Output filename |
|---|---|
| Exported mock (shared by other packages' tests) | `mock.gen.go` |
| Test-only mock (same package) | `mock_test.gen.go` |
| Multiple mock files in one package | `<descriptive>_mock_test.gen.go` |

## Test Helpers and Lifecycle

Mark every helper with `t.Helper()`. Use `t.Cleanup()` for teardown. Use `t.TempDir()` for temp files.

```go
func newTestService(t *testing.T) *Service {
    t.Helper()
    store := newMemoryControlStore()
    return NewService(store, nil)
}
```

## HTTP Handler Testing

Use `httptest.NewRecorder` for handler tests. Wire routes with `tenantauth.HTTPMiddleware` (fake tenant mode) to match production middleware.

```go
func doRequest(handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
    request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
    if strings.TrimSpace(body) != "" {
        request.Header.Set("Content-Type", "application/json")
    }
    response := httptest.NewRecorder()
    handler.ServeHTTP(response, request)
    return response
}

// Setup mux with routes
mux := http.NewServeMux()
protected := tenantauth.HTTPMiddleware(tenantauth.Config{Enabled: false, FakeTenantID: "fake"})
RegisterHTTPRoutes(mux, controlSvc, protected)

resp := doRequest(mux, http.MethodPost, "/api/v1/eval/evaluators", payload)
if resp.Code != http.StatusOK {
    t.Fatalf("expected 200, got %d body=%s", resp.Code, resp.Body.String())
}
```

## Database Tests (testcontainers)

MySQL integration tests use testcontainers-go with a shared container pattern. One MySQL 8.4 container per package, per-test databases for isolation.

```go
// In package_test.go or test_helpers_test.go
var (
    sharedMySQLOnce      sync.Once
    sharedMySQLContainer testcontainers.Container
    sharedMySQLHost      string
    sharedMySQLPort      string
    sharedMySQLErr       error
    testDatabaseSeq      atomic.Uint64
)

func TestMain(m *testing.M) {
    code := m.Run()
    if sharedMySQLContainer != nil {
        _ = sharedMySQLContainer.Terminate(context.Background())
    }
    os.Exit(code)
}

func newTestWALStore(t *testing.T) (*WALStore, func()) {
    t.Helper()
    host, port := ensureSharedMySQLContainer(t)
    dbName := fmt.Sprintf("sigil_test_%d", testDatabaseSeq.Add(1))
    // ... create database, return store + cleanup
}
```

**Conventions:**
- Skip gracefully when Docker is unavailable: `t.Skipf("skip mysql integration tests...")`
- Give each test its own database for full isolation.
- Drop per-test databases in cleanup; terminate the container in `TestMain`.

## Test Commands

This is a monorepo with a `go.work` at the root and multiple Go modules:

| Module | Path |
|---|---|
| sigil (server) | `sigil/` |
| Grafana plugin | `apps/plugin/` |
| Go SDK | `sdks/go/` |
| Go SDK providers | `sdks/go-providers/{anthropic,gemini,openai}/` |
| Go SDK frameworks | `sdks/go-frameworks/google-adk/` |
| devex emitter | `sdks/go/cmd/devex-emitter/` |

Use `GOWORK=off` when running tests inside a single module to avoid cross-module interference.

```bash
# Run tests for a specific module (cd into the module, disable workspace)
cd sigil && GOWORK=off go test ./...
cd sdks/go && GOWORK=off go test ./...
cd apps/plugin && GOWORK=off go test ./...

# Run a specific package within a module
cd sigil && GOWORK=off go test ./internal/eval/control/... -count=1

# Run a specific test
cd sigil && GOWORK=off go test ./internal/eval/control/... -run TestSpecificFunction -v
```

### mise Tasks

```bash
# Quality gates
mise run check              # lint + typecheck + tests (all languages)
mise run test               # all project tests (Go, TS, Helm, SDKs)
mise run lint               # Go, TS, Helm, .NET linting
mise run format             # format Go and TypeScript
mise run format:check       # verify formatting without modifying

# Go-specific
mise run test:go:all-modules   # go test across all Go SDK modules
mise run test:coverage:go      # Go tests with coverage report
mise run bench:storage         # WAL, object, compactor, fan-out benchmarks
mise run generate:mocks        # generate mock implementations
mise run generate              # generate all code (mocks, etc.)

# Individual Go SDK modules
mise run test:go:sdk-core      # Go SDK core
mise run test:go:sdk-anthropic # Anthropic provider
mise run test:go:sdk-openai    # OpenAI provider
mise run test:go:sdk-gemini    # Gemini provider
mise run test:go:sdk-google-adk # Google ADK framework
```

## The Design Rule

**If mocking code is more complex than production code, the abstraction needs work.** Accept interfaces, return structs. Define small 1-3 method interfaces at the consumer.

## Quick Reference: Go Testing

| Need | Use |
|---|---|
| Multiple scenarios | Table-driven `t.Run` |
| Mock a dependency | moq (`mise run generate:mocks`) |
| Stop on failure | `t.Fatalf(...)` |
| Continue on failure | `t.Errorf(...)` |
| Test HTTP handlers | `httptest.NewRecorder` + `doRequest` helper |
| Database tests | testcontainers MySQL (`newTestWALStore`) |
| Temp files | `t.TempDir()` |
| Teardown | `t.Cleanup(func() { ... })` |
| Run module tests | `cd <module> && GOWORK=off go test ./...` |
| Run all tests | `mise run test` |
| Full quality gate | `mise run check` |
| Generate mocks | `mise run generate:mocks` |
