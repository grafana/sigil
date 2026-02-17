package worker

import (
	"context"
	"errors"
	"hash/fnv"
	"testing"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
)

func TestHotColdGenerationReaderReturnsHotGeneration(t *testing.T) {
	hotGeneration := &sigilv1.Generation{Id: "gen-hot"}
	hotReader := &hotReaderStub{generation: hotGeneration}
	reader := NewHotColdGenerationReader(hotReader, &blockMetadataStoreStub{}, &blockReaderStub{})

	got, err := reader.GetByID(context.Background(), "tenant-a", "gen-hot")
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}
	if got == nil || got.GetId() != "gen-hot" {
		t.Fatalf("expected hot generation gen-hot, got %#v", got)
	}
}

func TestHotColdGenerationReaderFallsBackToCold(t *testing.T) {
	hotReader := &hotReaderStub{}
	metadataStore := &blockMetadataStoreStub{
		blocks: []storage.BlockMeta{{BlockID: "block-1"}},
	}
	blockReader := &blockReaderStub{
		indexByBlock: map[string]*storage.BlockIndex{
			"block-1": {
				Entries: []storage.IndexEntry{{GenerationIDHash: hashGenerationID("gen-cold"), Offset: 100, Length: 20}},
			},
		},
		generationsByBlock: map[string][]*sigilv1.Generation{
			"block-1": {{Id: "gen-cold"}},
		},
	}
	reader := NewHotColdGenerationReader(hotReader, metadataStore, blockReader)

	got, err := reader.GetByID(context.Background(), "tenant-a", "gen-cold")
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}
	if got == nil || got.GetId() != "gen-cold" {
		t.Fatalf("expected cold generation gen-cold, got %#v", got)
	}
}

func TestHotColdGenerationReaderReturnsNilWhenMissing(t *testing.T) {
	hotReader := &hotReaderStub{}
	metadataStore := &blockMetadataStoreStub{
		blocks: []storage.BlockMeta{{BlockID: "block-1"}},
	}
	blockReader := &blockReaderStub{
		indexByBlock:       map[string]*storage.BlockIndex{"block-1": {Entries: []storage.IndexEntry{}}},
		generationsByBlock: map[string][]*sigilv1.Generation{},
	}
	reader := NewHotColdGenerationReader(hotReader, metadataStore, blockReader)

	got, err := reader.GetByID(context.Background(), "tenant-a", "missing")
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil generation for miss, got %#v", got)
	}
}

func TestHotColdGenerationReaderPropagatesColdLookupErrors(t *testing.T) {
	hotReader := &hotReaderStub{}
	metadataStore := &blockMetadataStoreStub{listErr: errors.New("list failed")}
	reader := NewHotColdGenerationReader(hotReader, metadataStore, &blockReaderStub{})

	_, err := reader.GetByID(context.Background(), "tenant-a", "gen-1")
	if err == nil {
		t.Fatalf("expected cold lookup error")
	}
}

type hotReaderStub struct {
	generation *sigilv1.Generation
	err        error
}

func (s *hotReaderStub) GetByID(_ context.Context, _, generationID string) (*sigilv1.Generation, error) {
	if s.err != nil {
		return nil, s.err
	}
	if s.generation == nil {
		return nil, nil
	}
	copied := *s.generation
	copied.Id = generationID
	return &copied, nil
}

type blockMetadataStoreStub struct {
	blocks  []storage.BlockMeta
	listErr error
}

func (s *blockMetadataStoreStub) InsertBlock(context.Context, storage.BlockMeta) error {
	return nil
}

func (s *blockMetadataStoreStub) ListBlocks(_ context.Context, _ string, _, _ time.Time) ([]storage.BlockMeta, error) {
	if s.listErr != nil {
		return nil, s.listErr
	}
	return append([]storage.BlockMeta(nil), s.blocks...), nil
}

type blockReaderStub struct {
	indexByBlock       map[string]*storage.BlockIndex
	generationsByBlock map[string][]*sigilv1.Generation
	readIndexErr       error
	readGenerationsErr error
}

func (s *blockReaderStub) ReadIndex(_ context.Context, _ string, blockID string) (*storage.BlockIndex, error) {
	if s.readIndexErr != nil {
		return nil, s.readIndexErr
	}
	if s.indexByBlock == nil {
		return &storage.BlockIndex{Entries: []storage.IndexEntry{}}, nil
	}
	if index, ok := s.indexByBlock[blockID]; ok {
		return index, nil
	}
	return &storage.BlockIndex{Entries: []storage.IndexEntry{}}, nil
}

func (s *blockReaderStub) ReadGenerations(_ context.Context, _ string, blockID string, _ []storage.IndexEntry) ([]*sigilv1.Generation, error) {
	if s.readGenerationsErr != nil {
		return nil, s.readGenerationsErr
	}
	if s.generationsByBlock == nil {
		return []*sigilv1.Generation{}, nil
	}
	generations, ok := s.generationsByBlock[blockID]
	if !ok {
		return []*sigilv1.Generation{}, nil
	}
	out := make([]*sigilv1.Generation, 0, len(generations))
	for _, generation := range generations {
		copied := *generation
		out = append(out, &copied)
	}
	return out, nil
}

func hashGenerationID(value string) uint64 {
	hasher := fnv.New64a()
	_, _ = hasher.Write([]byte(value))
	return hasher.Sum64()
}
