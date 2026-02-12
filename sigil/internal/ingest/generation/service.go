package generation

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/grafana/dskit/tenant"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	defaultOperationNameSync   = "generateText"
	defaultOperationNameStream = "streamText"
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
	store Store
}

func NewService(store Store) *Service {
	return &Service{store: store}
}

func (s *Service) Export(ctx context.Context, req *sigilv1.ExportGenerationsRequest) *sigilv1.ExportGenerationsResponse {
	if req == nil || len(req.Generations) == 0 {
		return &sigilv1.ExportGenerationsResponse{}
	}

	results := make([]ExportResult, len(req.Generations))
	accepted := make([]*sigilv1.Generation, 0, len(req.Generations))
	acceptedIdx := make([]int, 0, len(req.Generations))

	for i := range req.Generations {
		generation := cloneGeneration(req.Generations[i])
		if generation == nil {
			results[i] = ExportResult{Accepted: false, Error: "generation is required"}
			continue
		}

		normalizeGeneration(generation)
		if err := validateGeneration(generation); err != nil {
			results[i] = ExportResult{GenerationID: generation.Id, Accepted: false, Error: err.Error()}
			continue
		}

		results[i] = ExportResult{GenerationID: generation.Id, Accepted: true}
		accepted = append(accepted, generation)
		acceptedIdx = append(acceptedIdx, i)
	}

	if len(accepted) > 0 {
		tenantID, err := tenant.TenantID(ctx)
		if err != nil {
			for _, idx := range acceptedIdx {
				results[idx].Accepted = false
				results[idx].Error = err.Error()
			}
		} else {
			errs := s.store.SaveBatch(ctx, tenantID, accepted)
			for i := range acceptedIdx {
				idx := acceptedIdx[i]
				if i < len(errs) && errs[i] != nil {
					results[idx].Accepted = false
					results[idx].Error = errs[i].Error()
				}
			}
		}
	}

	response := &sigilv1.ExportGenerationsResponse{Results: make([]*sigilv1.ExportGenerationResult, len(results))}
	for i := range results {
		response.Results[i] = &sigilv1.ExportGenerationResult{
			GenerationId: results[i].GenerationID,
			Accepted:     results[i].Accepted,
			Error:        results[i].Error,
		}
	}

	return response
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
