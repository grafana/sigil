package modelcards

import (
	"path/filepath"
	"testing"
	"time"
)

func TestComputeSupplementalChecksumNormalizesNilAndEmptySlices(t *testing.T) {
	checksumWithNil := ComputeSupplementalChecksum(nil, nil)
	checksumWithEmpty := ComputeSupplementalChecksum([]SupplementalModel{}, []SupplementalPatch{})
	if checksumWithNil != checksumWithEmpty {
		t.Fatalf("expected nil/empty checksum equivalence, got nil=%q empty=%q", checksumWithNil, checksumWithEmpty)
	}
}

func TestWriteAndLoadSupplementalWithEmptyPatches(t *testing.T) {
	path := filepath.Join(t.TempDir(), "supplemental.json")
	catalog := SupplementalCatalog{
		CapturedAt:    time.Now().UTC(),
		SchemaVersion: 1,
		Models: []SupplementalModel{
			{
				ModelKey:      "supplemental:provider/model-a",
				SourceModelID: "provider/model-a",
				Name:          "Model A",
				Provider:      "provider",
			},
		},
		Patches: []SupplementalPatch{},
	}

	if err := WriteSupplementalFile(path, catalog); err != nil {
		t.Fatalf("write supplemental file: %v", err)
	}
	loaded, err := LoadSupplementalFile(path)
	if err != nil {
		t.Fatalf("load supplemental file: %v", err)
	}
	if len(loaded.Models) != 1 {
		t.Fatalf("expected one model in loaded catalog, got %d", len(loaded.Models))
	}
	if len(loaded.Patches) != 0 {
		t.Fatalf("expected zero patches in loaded catalog, got %d", len(loaded.Patches))
	}
}
