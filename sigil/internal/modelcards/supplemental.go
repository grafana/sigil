package modelcards

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const supplementalSchemaVersion = 1

var ErrSupplementalInvalid = errors.New("invalid supplemental model catalog")

//go:embed fallback/supplemental_models.v1.json
var embeddedSupplementalBytes []byte

type SupplementalCatalog struct {
	CapturedAt     time.Time           `json:"captured_at"`
	SchemaVersion  int                 `json:"schema_version"`
	ChecksumSHA256 string              `json:"checksum_sha256"`
	Models         []SupplementalModel `json:"models"`
	Patches        []SupplementalPatch `json:"patches,omitempty"`
}

type SupplementalModel SnapshotModel

type SupplementalPatch struct {
	TargetSource        string                        `json:"target_source,omitempty"`
	TargetSourceModelID string                        `json:"target_source_model_id"`
	CanonicalSlug       *string                       `json:"canonical_slug,omitempty"`
	Name                *string                       `json:"name,omitempty"`
	Provider            *string                       `json:"provider,omitempty"`
	Description         *string                       `json:"description,omitempty"`
	ContextLength       *int                          `json:"context_length,omitempty"`
	Modality            *string                       `json:"modality,omitempty"`
	InputModalities     *[]string                     `json:"input_modalities,omitempty"`
	OutputModalities    *[]string                     `json:"output_modalities,omitempty"`
	SupportedParameters *[]string                     `json:"supported_parameters,omitempty"`
	Tokenizer           *string                       `json:"tokenizer,omitempty"`
	Pricing             *SupplementalPricingPatch     `json:"pricing,omitempty"`
	IsFree              *bool                         `json:"is_free,omitempty"`
	TopProvider         *SupplementalTopProviderPatch `json:"top_provider,omitempty"`
	ExpiresAt           *time.Time                    `json:"expires_at,omitempty"`
}

type SupplementalPricingPatch struct {
	PromptUSDPerToken          *float64 `json:"prompt_usd_per_token,omitempty"`
	CompletionUSDPerToken      *float64 `json:"completion_usd_per_token,omitempty"`
	RequestUSD                 *float64 `json:"request_usd,omitempty"`
	ImageUSD                   *float64 `json:"image_usd,omitempty"`
	WebSearchUSD               *float64 `json:"web_search_usd,omitempty"`
	InputCacheReadUSDPerToken  *float64 `json:"input_cache_read_usd_per_token,omitempty"`
	InputCacheWriteUSDPerToken *float64 `json:"input_cache_write_usd_per_token,omitempty"`
}

type SupplementalTopProviderPatch struct {
	ContextLength       *int  `json:"context_length,omitempty"`
	MaxCompletionTokens *int  `json:"max_completion_tokens,omitempty"`
	IsModerated         *bool `json:"is_moderated,omitempty"`
}

func LoadEmbeddedSupplemental() (*SupplementalCatalog, error) {
	return ParseSupplemental(embeddedSupplementalBytes)
}

func LoadSupplementalFile(path string) (*SupplementalCatalog, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("%w: read supplemental file: %w", ErrSupplementalInvalid, err)
	}
	return ParseSupplemental(content)
}

func ParseSupplemental(content []byte) (*SupplementalCatalog, error) {
	var catalog SupplementalCatalog
	if err := json.Unmarshal(content, &catalog); err != nil {
		return nil, fmt.Errorf("%w: unmarshal supplemental catalog: %w", ErrSupplementalInvalid, err)
	}
	CanonicalizeSupplemental(&catalog)
	if err := ValidateSupplemental(catalog); err != nil {
		return nil, err
	}
	return &catalog, nil
}

func WriteSupplementalFile(path string, catalog SupplementalCatalog) error {
	CanonicalizeSupplemental(&catalog)
	catalog.ChecksumSHA256 = ComputeSupplementalChecksum(catalog.Models, catalog.Patches)

	data, err := json.MarshalIndent(catalog, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal supplemental catalog: %w", err)
	}
	data = append(data, '\n')

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("ensure supplemental dir: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write supplemental catalog: %w", err)
	}
	return nil
}

func CheckSupplementalFileCanonical(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	catalog, err := LoadSupplementalFile(path)
	if err != nil {
		return err
	}
	canonical := *catalog
	CanonicalizeSupplemental(&canonical)
	canonical.ChecksumSHA256 = ComputeSupplementalChecksum(canonical.Models, canonical.Patches)

	canonicalBytes, err := json.MarshalIndent(canonical, "", "  ")
	if err != nil {
		return err
	}
	canonicalBytes = append(canonicalBytes, '\n')
	if !bytes.Equal(raw, canonicalBytes) {
		return fmt.Errorf("%w: supplemental file is not canonical, run generator/check tooling", ErrSupplementalInvalid)
	}
	return nil
}

func CanonicalizeSupplemental(catalog *SupplementalCatalog) {
	if catalog == nil {
		return
	}
	if catalog.Models == nil {
		catalog.Models = []SupplementalModel{}
	}
	if catalog.Patches == nil {
		catalog.Patches = []SupplementalPatch{}
	}

	for i := range catalog.Models {
		model := &catalog.Models[i]
		model.ModelKey = strings.TrimSpace(model.ModelKey)
		model.SourceModelID = strings.TrimSpace(model.SourceModelID)
		model.CanonicalSlug = strings.TrimSpace(model.CanonicalSlug)
		model.Name = strings.TrimSpace(model.Name)
		model.Provider = strings.TrimSpace(model.Provider)
		model.Description = strings.TrimSpace(model.Description)
		model.Modality = strings.TrimSpace(model.Modality)
		model.InputModalities = cleanStrings(model.InputModalities)
		model.OutputModalities = cleanStrings(model.OutputModalities)
		model.SupportedParameters = cleanStrings(model.SupportedParameters)
		model.Tokenizer = strings.TrimSpace(model.Tokenizer)
	}
	sort.Slice(catalog.Models, func(i, j int) bool {
		if catalog.Models[i].ModelKey == catalog.Models[j].ModelKey {
			return catalog.Models[i].SourceModelID < catalog.Models[j].SourceModelID
		}
		return catalog.Models[i].ModelKey < catalog.Models[j].ModelKey
	})

	for i := range catalog.Patches {
		patch := &catalog.Patches[i]
		patch.TargetSource = normalizeSupplementalTargetSource(patch.TargetSource)
		patch.TargetSourceModelID = strings.TrimSpace(patch.TargetSourceModelID)
		patch.CanonicalSlug = trimOptionalString(patch.CanonicalSlug)
		patch.Name = trimOptionalString(patch.Name)
		patch.Provider = trimOptionalString(patch.Provider)
		patch.Description = trimOptionalString(patch.Description)
		patch.Modality = trimOptionalString(patch.Modality)
		patch.Tokenizer = trimOptionalString(patch.Tokenizer)
		if patch.InputModalities != nil {
			values := cleanStrings(*patch.InputModalities)
			patch.InputModalities = &values
		}
		if patch.OutputModalities != nil {
			values := cleanStrings(*patch.OutputModalities)
			patch.OutputModalities = &values
		}
		if patch.SupportedParameters != nil {
			values := cleanStrings(*patch.SupportedParameters)
			patch.SupportedParameters = &values
		}
	}
	sort.Slice(catalog.Patches, func(i, j int) bool {
		leftSource := normalizeSupplementalTargetSource(catalog.Patches[i].TargetSource)
		rightSource := normalizeSupplementalTargetSource(catalog.Patches[j].TargetSource)
		if leftSource == rightSource {
			return catalog.Patches[i].TargetSourceModelID < catalog.Patches[j].TargetSourceModelID
		}
		return leftSource < rightSource
	})
}

func ValidateSupplemental(catalog SupplementalCatalog) error {
	if catalog.SchemaVersion != supplementalSchemaVersion {
		return fmt.Errorf("%w: unsupported supplemental schema version %d", ErrSupplementalInvalid, catalog.SchemaVersion)
	}
	if catalog.CapturedAt.IsZero() {
		return fmt.Errorf("%w: supplemental captured_at is required", ErrSupplementalInvalid)
	}

	modelKeys := make(map[string]struct{}, len(catalog.Models))
	sourceIDs := make(map[string]struct{}, len(catalog.Models))
	for _, model := range catalog.Models {
		if model.ModelKey == "" {
			return fmt.Errorf("%w: supplemental model_key is required", ErrSupplementalInvalid)
		}
		if model.SourceModelID == "" {
			return fmt.Errorf("%w: supplemental source_model_id is required", ErrSupplementalInvalid)
		}
		if model.Name == "" {
			return fmt.Errorf("%w: supplemental model name is required", ErrSupplementalInvalid)
		}
		if _, ok := modelKeys[model.ModelKey]; ok {
			return fmt.Errorf("%w: duplicate supplemental model_key %q", ErrSupplementalInvalid, model.ModelKey)
		}
		modelKeys[model.ModelKey] = struct{}{}

		sourceIDKey := sourceModelLookupKey(SourceSupplemental, model.SourceModelID)
		if _, ok := sourceIDs[sourceIDKey]; ok {
			return fmt.Errorf("%w: duplicate supplemental source_model_id %q", ErrSupplementalInvalid, model.SourceModelID)
		}
		sourceIDs[sourceIDKey] = struct{}{}
	}

	patchTargets := make(map[string]struct{}, len(catalog.Patches))
	for _, patch := range catalog.Patches {
		targetSource := normalizeSupplementalTargetSource(patch.TargetSource)
		if patch.TargetSourceModelID == "" {
			return fmt.Errorf("%w: supplemental patch target_source_model_id is required", ErrSupplementalInvalid)
		}
		if !patch.hasUpdates() {
			return fmt.Errorf("%w: supplemental patch for %s/%s has no fields to update", ErrSupplementalInvalid, targetSource, patch.TargetSourceModelID)
		}
		targetKey := sourceModelLookupKey(targetSource, patch.TargetSourceModelID)
		if _, ok := patchTargets[targetKey]; ok {
			return fmt.Errorf("%w: duplicate supplemental patch target %s", ErrSupplementalInvalid, targetKey)
		}
		patchTargets[targetKey] = struct{}{}

		if patch.ContextLength != nil && *patch.ContextLength < 0 {
			return fmt.Errorf("%w: supplemental patch context_length must be >= 0", ErrSupplementalInvalid)
		}
		if patch.TopProvider != nil {
			if patch.TopProvider.ContextLength != nil && *patch.TopProvider.ContextLength < 0 {
				return fmt.Errorf("%w: supplemental patch top_provider.context_length must be >= 0", ErrSupplementalInvalid)
			}
			if patch.TopProvider.MaxCompletionTokens != nil && *patch.TopProvider.MaxCompletionTokens < 0 {
				return fmt.Errorf("%w: supplemental patch top_provider.max_completion_tokens must be >= 0", ErrSupplementalInvalid)
			}
		}
		if patch.Pricing != nil {
			for _, value := range []*float64{
				patch.Pricing.PromptUSDPerToken,
				patch.Pricing.CompletionUSDPerToken,
				patch.Pricing.RequestUSD,
				patch.Pricing.ImageUSD,
				patch.Pricing.WebSearchUSD,
				patch.Pricing.InputCacheReadUSDPerToken,
				patch.Pricing.InputCacheWriteUSDPerToken,
			} {
				if value == nil {
					continue
				}
				if math.IsNaN(*value) || math.IsInf(*value, 0) {
					return fmt.Errorf("%w: supplemental pricing patch contains non-finite value", ErrSupplementalInvalid)
				}
			}
		}
	}

	expectedChecksum := ComputeSupplementalChecksum(catalog.Models, catalog.Patches)
	if catalog.ChecksumSHA256 != expectedChecksum {
		return fmt.Errorf(
			"%w: supplemental checksum mismatch: got %q expected %q",
			ErrSupplementalInvalid,
			catalog.ChecksumSHA256,
			expectedChecksum,
		)
	}
	return nil
}

func ComputeSupplementalChecksum(models []SupplementalModel, patches []SupplementalPatch) string {
	if models == nil {
		models = []SupplementalModel{}
	}
	if patches == nil {
		patches = []SupplementalPatch{}
	}
	payload := struct {
		Models  []SupplementalModel `json:"models"`
		Patches []SupplementalPatch `json:"patches"`
	}{
		Models:  models,
		Patches: patches,
	}
	raw, _ := json.Marshal(payload)
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}

func normalizeSupplementalTargetSource(source string) string {
	source = strings.TrimSpace(strings.ToLower(source))
	if source == "" {
		return SourceOpenRouter
	}
	return source
}

func trimOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	v := strings.TrimSpace(*value)
	return &v
}

func (p SupplementalPatch) hasUpdates() bool {
	if p.CanonicalSlug != nil || p.Name != nil || p.Provider != nil || p.Description != nil {
		return true
	}
	if p.ContextLength != nil || p.Modality != nil || p.Tokenizer != nil || p.IsFree != nil || p.ExpiresAt != nil {
		return true
	}
	if p.InputModalities != nil || p.OutputModalities != nil || p.SupportedParameters != nil {
		return true
	}
	if p.Pricing != nil && p.Pricing.hasUpdates() {
		return true
	}
	if p.TopProvider != nil && p.TopProvider.hasUpdates() {
		return true
	}
	return false
}

func (p SupplementalPricingPatch) hasUpdates() bool {
	return p.PromptUSDPerToken != nil ||
		p.CompletionUSDPerToken != nil ||
		p.RequestUSD != nil ||
		p.ImageUSD != nil ||
		p.WebSearchUSD != nil ||
		p.InputCacheReadUSDPerToken != nil ||
		p.InputCacheWriteUSDPerToken != nil
}

func (p SupplementalTopProviderPatch) hasUpdates() bool {
	return p.ContextLength != nil || p.MaxCompletionTokens != nil || p.IsModerated != nil
}
