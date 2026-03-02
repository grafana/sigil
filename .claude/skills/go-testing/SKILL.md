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
                t.Fatalf("expected error containing %q, got %v", tt.wantErr, err)
            }
            return
        }
        if err != nil {
            t.Fatalf("unexpected error: %v", err)
        }
        if got != tt.want {
            t.Fatalf("got %v, want %v", got, tt.want)
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

```bash
# Generate all mocks
mise run generate:mocks

# One-off (for experimentation, then add to the task)
moq -rm -out ./sigil/internal/eval/control/mock_test.gen.go ./sigil/internal/eval/control controlStore

# Cross-package mock (set correct package with -pkg)
moq -rm -pkg control -out ./sigil/internal/eval/control/mock_eval_test.gen.go ./sigil/internal/eval EvalStore
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

```bash
# Run sigil module tests
cd sigil && GOWORK=off go test ./...

# Run specific package
cd sigil && GOWORK=off go test ./internal/eval/control/... -count=1

# Run specific test
cd sigil && GOWORK=off go test ./internal/eval/control/... -run TestSpecificFunction -v

# Run all project tests (Go, TS, Helm, SDKs)
mise run test

# Generate mocks
mise run generate:mocks

# Run storage benchmarks
mise run bench:storage
```

## The Design Rule

**If mocking code is more complex than production code, the abstraction needs work.** Accept interfaces, return structs. Define small 1-3 method interfaces at the consumer.

## Quick Reference

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
| Run tests | `cd sigil && GOWORK=off go test ./...` |
| Generate mocks | `mise run generate:mocks` |
