package modelcards

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const snapshotSchemaVersion = 1

//go:embed fallback/openrouter_models.v1.json
var embeddedSnapshotBytes []byte

type Snapshot struct {
	Source         string          `json:"source"`
	CapturedAt     time.Time       `json:"captured_at"`
	SchemaVersion  int             `json:"schema_version"`
	ChecksumSHA256 string          `json:"checksum_sha256"`
	Models         []SnapshotModel `json:"models"`
}

type SnapshotModel struct {
	ModelKey            string      `json:"model_key"`
	SourceModelID       string      `json:"source_model_id"`
	CanonicalSlug       string      `json:"canonical_slug,omitempty"`
	Name                string      `json:"name"`
	Provider            string      `json:"provider,omitempty"`
	Description         string      `json:"description,omitempty"`
	ContextLength       *int        `json:"context_length,omitempty"`
	Modality            string      `json:"modality,omitempty"`
	InputModalities     []string    `json:"input_modalities,omitempty"`
	OutputModalities    []string    `json:"output_modalities,omitempty"`
	SupportedParameters []string    `json:"supported_parameters,omitempty"`
	Tokenizer           string      `json:"tokenizer,omitempty"`
	Pricing             Pricing     `json:"pricing"`
	IsFree              bool        `json:"is_free"`
	TopProvider         TopProvider `json:"top_provider"`
	ExpiresAt           *time.Time  `json:"expires_at,omitempty"`
}

func LoadEmbeddedSnapshot() (*Snapshot, error) {
	return ParseSnapshot(embeddedSnapshotBytes)
}

func LoadSnapshotFile(path string) (*Snapshot, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read snapshot: %w", err)
	}
	return ParseSnapshot(content)
}

func ParseSnapshot(content []byte) (*Snapshot, error) {
	var snapshot Snapshot
	if err := json.Unmarshal(content, &snapshot); err != nil {
		return nil, fmt.Errorf("unmarshal snapshot: %w", err)
	}
	CanonicalizeSnapshot(&snapshot)
	if err := ValidateSnapshot(snapshot); err != nil {
		return nil, err
	}
	return &snapshot, nil
}

func WriteSnapshotFile(path string, snapshot Snapshot) error {
	CanonicalizeSnapshot(&snapshot)
	snapshot.ChecksumSHA256 = ComputeSnapshotChecksum(snapshot.Models)

	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal snapshot: %w", err)
	}
	data = append(data, '\n')

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("ensure snapshot dir: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write snapshot: %w", err)
	}
	return nil
}

func ValidateSnapshot(snapshot Snapshot) error {
	if snapshot.SchemaVersion != snapshotSchemaVersion {
		return fmt.Errorf("unsupported snapshot schema version %d", snapshot.SchemaVersion)
	}
	if snapshot.Source == "" {
		return errors.New("snapshot source is required")
	}
	if snapshot.CapturedAt.IsZero() {
		return errors.New("snapshot captured_at is required")
	}

	lastKey := ""
	seen := make(map[string]struct{}, len(snapshot.Models))
	for _, model := range snapshot.Models {
		if model.ModelKey == "" {
			return errors.New("snapshot model_key is required")
		}
		if model.SourceModelID == "" {
			return errors.New("snapshot source_model_id is required")
		}
		if model.Name == "" {
			return errors.New("snapshot name is required")
		}
		if _, exists := seen[model.ModelKey]; exists {
			return fmt.Errorf("duplicate snapshot model_key %q", model.ModelKey)
		}
		seen[model.ModelKey] = struct{}{}
		if lastKey != "" && model.ModelKey < lastKey {
			return errors.New("snapshot models must be sorted by model_key")
		}
		lastKey = model.ModelKey
	}

	expected := ComputeSnapshotChecksum(snapshot.Models)
	if snapshot.ChecksumSHA256 != expected {
		return fmt.Errorf("snapshot checksum mismatch: got %q expected %q", snapshot.ChecksumSHA256, expected)
	}

	return nil
}

func CanonicalizeSnapshot(snapshot *Snapshot) {
	if snapshot == nil {
		return
	}
	sort.Slice(snapshot.Models, func(i, j int) bool {
		if snapshot.Models[i].ModelKey == snapshot.Models[j].ModelKey {
			return snapshot.Models[i].SourceModelID < snapshot.Models[j].SourceModelID
		}
		return snapshot.Models[i].ModelKey < snapshot.Models[j].ModelKey
	})
}

func ComputeSnapshotChecksum(models []SnapshotModel) string {
	payload, _ := json.Marshal(models)
	hash := sha256.Sum256(payload)
	return hex.EncodeToString(hash[:])
}

func SnapshotFromCards(source string, capturedAt time.Time, cards []Card) Snapshot {
	models := make([]SnapshotModel, 0, len(cards))
	for _, card := range cards {
		models = append(models, SnapshotModel{
			ModelKey:            card.ModelKey,
			SourceModelID:       card.SourceModelID,
			CanonicalSlug:       card.CanonicalSlug,
			Name:                card.Name,
			Provider:            card.Provider,
			Description:         card.Description,
			ContextLength:       card.ContextLength,
			Modality:            card.Modality,
			InputModalities:     append([]string{}, card.InputModalities...),
			OutputModalities:    append([]string{}, card.OutputModalities...),
			SupportedParameters: append([]string{}, card.SupportedParameters...),
			Tokenizer:           card.Tokenizer,
			Pricing:             card.Pricing,
			IsFree:              card.IsFree,
			TopProvider:         card.TopProvider,
			ExpiresAt:           card.ExpiresAt,
		})
	}

	snapshot := Snapshot{
		Source:        source,
		CapturedAt:    capturedAt.UTC(),
		SchemaVersion: snapshotSchemaVersion,
		Models:        models,
	}
	CanonicalizeSnapshot(&snapshot)
	snapshot.ChecksumSHA256 = ComputeSnapshotChecksum(snapshot.Models)
	return snapshot
}

func CardsFromSnapshot(snapshot Snapshot, refreshedAt time.Time) []Card {
	cards := make([]Card, 0, len(snapshot.Models))
	for _, model := range snapshot.Models {
		cards = append(cards, Card{
			ModelKey:            model.ModelKey,
			Source:              snapshot.Source,
			SourceModelID:       model.SourceModelID,
			CanonicalSlug:       model.CanonicalSlug,
			Name:                model.Name,
			Provider:            model.Provider,
			Description:         model.Description,
			ContextLength:       model.ContextLength,
			Modality:            model.Modality,
			InputModalities:     append([]string{}, model.InputModalities...),
			OutputModalities:    append([]string{}, model.OutputModalities...),
			SupportedParameters: append([]string{}, model.SupportedParameters...),
			Tokenizer:           model.Tokenizer,
			Pricing:             model.Pricing,
			IsFree:              model.IsFree,
			TopProvider:         model.TopProvider,
			ExpiresAt:           model.ExpiresAt,
			FirstSeenAt:         refreshedAt,
			LastSeenAt:          refreshedAt,
			RefreshedAt:         refreshedAt,
			RawPayloadJSON:      "{}",
		})
	}
	return cards
}
