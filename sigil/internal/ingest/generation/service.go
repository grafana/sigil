package generation

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/grafana/dskit/tenant"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	defaultOperationNameSync   = "generateText"
	defaultOperationNameStream = "streamText"
	defaultPersistTimeout      = 5 * time.Second
)

type ExportResult struct {
	GenerationID string
	Accepted     bool
	Error        string
}

type Store interface {
	SaveBatch(ctx context.Context, tenantID string, generations []*sigilv1.Generation) []error
}

type Exporter interface {
	Export(ctx context.Context, req *sigilv1.ExportGenerationsRequest) *sigilv1.ExportGenerationsResponse
}

type Service struct {
	store          Store
	persistTimeout time.Duration
}

var generationTracer = otel.Tracer("github.com/grafana/sigil/ingest/generation")

func NewService(store Store) *Service {
	return &Service{
		store:          store,
		persistTimeout: defaultPersistTimeout,
	}
}

func (s *Service) Export(ctx context.Context, req *sigilv1.ExportGenerationsRequest) *sigilv1.ExportGenerationsResponse {
	requestedCount := 0
	if req != nil {
		requestedCount = len(req.Generations)
	}
	transport := transportFromContext(ctx)
	observeGenerationBatchSize(transport, requestedCount)

	ctx, span := generationTracer.Start(
		ctx,
		"sigil.generation.export",
		trace.WithAttributes(attribute.Int("sigil.generation.requested_count", requestedCount)),
	)
	defer span.End()
	metricTenantID := ""
	if tenantID, err := tenant.TenantID(ctx); err == nil {
		metricTenantID = tenantID
	}

	if req == nil || len(req.Generations) == 0 {
		span.SetAttributes(
			attribute.Int("sigil.generation.accepted_count", 0),
			attribute.Int("sigil.generation.rejected_count", 0),
		)
		return &sigilv1.ExportGenerationsResponse{}
	}

	results := make([]ExportResult, len(req.Generations))
	accepted := make([]*sigilv1.Generation, 0, len(req.Generations))
	acceptedIdx := make([]int, 0, len(req.Generations))
	modes := make([]sigilv1.GenerationMode, len(req.Generations))
	reasons := make([]string, len(req.Generations))

	for i := range req.Generations {
		generation := cloneGeneration(req.Generations[i])
		if generation == nil {
			results[i] = ExportResult{Accepted: false, Error: "generation is required"}
			reasons[i] = "nil_generation"
			continue
		}

		normalizeGeneration(generation)
		modes[i] = generation.GetMode()
		if err := validateGeneration(generation); err != nil {
			results[i] = ExportResult{GenerationID: generation.Id, Accepted: false, Error: err.Error()}
			reasons[i] = "validation"
			continue
		}

		results[i] = ExportResult{GenerationID: generation.Id, Accepted: true}
		accepted = append(accepted, generation)
		acceptedIdx = append(acceptedIdx, i)
	}

	if len(accepted) > 0 {
		tenantID, err := tenant.TenantID(ctx)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "resolve tenant")
			for _, idx := range acceptedIdx {
				results[idx].Accepted = false
				results[idx].Error = err.Error()
				reasons[idx] = "tenant_resolution"
			}
		} else {
			metricTenantID = tenantID
			span.SetAttributes(attribute.String("sigil.tenant.id", tenantID))
			storeCtx, cancel := detachedPersistContext(ctx, s.persistTimeout)
			defer cancel()
			storeCtx, storeSpan := generationTracer.Start(
				storeCtx,
				"sigil.generation.store.save_batch",
				trace.WithAttributes(
					attribute.String("sigil.tenant.id", tenantID),
					attribute.Int("sigil.generation.save_attempt_count", len(accepted)),
				),
			)
			errs := s.store.SaveBatch(storeCtx, tenantID, accepted)
			storeFailures := 0
			for i := range acceptedIdx {
				idx := acceptedIdx[i]
				if i < len(errs) && errs[i] != nil {
					storeFailures++
					results[idx].Accepted = false
					results[idx].Error = errs[i].Error()
					reasons[idx] = classifyExportErrorReason(errs[i], "store_error")
				}
			}
			storeSpan.SetAttributes(attribute.Int("sigil.generation.save_failure_count", storeFailures))
			if storeFailures > 0 {
				storeSpan.SetStatus(codes.Error, "save failures")
			}
			storeSpan.End()
		}
	}

	response := &sigilv1.ExportGenerationsResponse{Results: make([]*sigilv1.ExportGenerationResult, len(results))}
	for i := range results {
		if reasons[i] == "" && results[i].Accepted {
			reasons[i] = "none"
		}
		response.Results[i] = &sigilv1.ExportGenerationResult{
			GenerationId: results[i].GenerationID,
			Accepted:     results[i].Accepted,
			Error:        results[i].Error,
		}
		observeGenerationItemOutcome(metricTenantID, modes[i], results[i].Accepted, reasons[i], transport)
	}
	acceptedCount := 0
	for _, result := range results {
		if result.Accepted {
			acceptedCount++
		}
	}
	span.SetAttributes(
		attribute.Int("sigil.generation.accepted_count", acceptedCount),
		attribute.Int("sigil.generation.rejected_count", len(results)-acceptedCount),
	)

	return response
}

func classifyExportErrorReason(err error, fallback string) string {
	switch {
	case err == nil:
		return fallback
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, context.Canceled):
		return "canceled"
	default:
		return fallback
	}
}

func normalizeGeneration(g *sigilv1.Generation) {
	if g.Id == "" {
		g.Id = newGenerationID()
	}
	if g.Mode == sigilv1.GenerationMode_GENERATION_MODE_UNSPECIFIED {
		g.Mode = sigilv1.GenerationMode_GENERATION_MODE_SYNC
	}
	if g.OperationName == "" {
		g.OperationName = defaultOperationNameForMode(g.Mode)
	}
	if g.StartedAt == nil {
		g.StartedAt = timestamppb.New(time.Now().UTC())
	}
	if g.CompletedAt == nil {
		g.CompletedAt = timestamppb.New(time.Now().UTC())
	}
}

func validateGeneration(g *sigilv1.Generation) error {
	if g.Model == nil {
		return fmt.Errorf("generation.model is required")
	}
	if g.Model.Provider == "" {
		return fmt.Errorf("generation.model.provider is required")
	}
	if g.Model.Name == "" {
		return fmt.Errorf("generation.model.name is required")
	}
	if g.Mode != sigilv1.GenerationMode_GENERATION_MODE_SYNC && g.Mode != sigilv1.GenerationMode_GENERATION_MODE_STREAM {
		return fmt.Errorf("generation.mode is invalid")
	}
	return nil
}

func defaultOperationNameForMode(mode sigilv1.GenerationMode) string {
	if mode == sigilv1.GenerationMode_GENERATION_MODE_STREAM {
		return defaultOperationNameStream
	}
	return defaultOperationNameSync
}

func detachedPersistContext(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		timeout = defaultPersistTimeout
	}
	if ctx == nil {
		return context.WithTimeout(context.Background(), timeout)
	}
	return context.WithTimeout(context.WithoutCancel(ctx), timeout)
}

var generationCounter atomic.Uint64

func newGenerationID() string {
	counter := generationCounter.Add(1)
	return fmt.Sprintf("gen-%d", counter)
}

type MemoryStore struct {
	mu          sync.RWMutex
	generations map[string]*sigilv1.Generation
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{generations: map[string]*sigilv1.Generation{}}
}

func (s *MemoryStore) SaveBatch(_ context.Context, tenantID string, generations []*sigilv1.Generation) []error {
	s.mu.Lock()
	defer s.mu.Unlock()

	errResults := make([]error, len(generations))
	for i := range generations {
		s.generations[tenantGenerationKey(tenantID, generations[i].Id)] = cloneGeneration(generations[i])
	}
	return errResults
}

func (s *MemoryStore) Get(tenantID, id string) (*sigilv1.Generation, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	generation, ok := s.generations[tenantGenerationKey(tenantID, id)]
	if !ok {
		return nil, false
	}
	return cloneGeneration(generation), true
}

func tenantGenerationKey(tenantID, generationID string) string {
	return tenantID + "::" + generationID
}

func cloneGeneration(in *sigilv1.Generation) *sigilv1.Generation {
	if in == nil {
		return nil
	}
	cloned, ok := proto.Clone(in).(*sigilv1.Generation)
	if !ok {
		return nil
	}
	return cloned
}
