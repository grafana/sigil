package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"reflect"
	"strings"
	"time"

	"github.com/grafana/sigil/sigil/internal/modelcards"
)

const (
	defaultSnapshotOutputPath     = "./internal/modelcards/fallback/openrouter_models.v1.json"
	defaultSupplementalOutputPath = "./internal/modelcards/fallback/supplemental_models.v1.json"
)

func main() {
	mode := flag.String("mode", "check", "mode: update|check|update-supplemental|check-supplemental")
	output := flag.String("output", "", "deprecated alias for --snapshot-output")
	snapshotOutput := flag.String("snapshot-output", defaultSnapshotOutputPath, "snapshot output path")
	supplementalOutput := flag.String("supplemental-output", defaultSupplementalOutputPath, "supplemental catalog output path")
	timeout := flag.Duration("timeout", 30*time.Second, "live fetch timeout for update modes")
	flag.Parse()

	snapshotPath := strings.TrimSpace(*snapshotOutput)
	if override := strings.TrimSpace(*output); override != "" {
		snapshotPath = override
	}

	switch *mode {
	case "update":
		if err := runUpdateSnapshot(snapshotPath, *timeout); err != nil {
			fmt.Fprintf(os.Stderr, "modelcards snapshot update failed: %v\n", err)
			os.Exit(1)
		}
	case "check":
		if err := runCheckSnapshot(snapshotPath); err != nil {
			fmt.Fprintf(os.Stderr, "modelcards snapshot check failed: %v\n", err)
			os.Exit(1)
		}
	case "update-supplemental":
		if err := runUpdateSupplemental(snapshotPath, strings.TrimSpace(*supplementalOutput), *timeout); err != nil {
			fmt.Fprintf(os.Stderr, "modelcards supplemental update failed: %v\n", err)
			os.Exit(1)
		}
	case "check-supplemental":
		if err := runCheckSupplemental(snapshotPath, strings.TrimSpace(*supplementalOutput)); err != nil {
			fmt.Fprintf(os.Stderr, "modelcards supplemental check failed: %v\n", err)
			os.Exit(1)
		}
	default:
		fmt.Fprintf(os.Stderr, "unsupported mode %q\n", *mode)
		os.Exit(1)
	}
}

func runUpdateSnapshot(output string, timeout time.Duration) error {
	source := modelcards.NewOpenRouterSource(timeout)
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cards, err := source.Fetch(ctx)
	if err != nil {
		return err
	}
	snapshot := modelcards.SnapshotFromCards(source.Name(), time.Now().UTC(), cards)
	if err := modelcards.WriteSnapshotFile(output, snapshot); err != nil {
		return err
	}
	fmt.Printf("wrote %d model cards to %s\n", len(snapshot.Models), output)
	return nil
}

func runCheckSnapshot(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	snapshot, err := modelcards.LoadSnapshotFile(path)
	if err != nil {
		return err
	}

	canonical := *snapshot
	modelcards.CanonicalizeSnapshot(&canonical)
	canonical.ChecksumSHA256 = modelcards.ComputeSnapshotChecksum(canonical.Models)
	canonicalBytes, err := json.MarshalIndent(canonical, "", "  ")
	if err != nil {
		return err
	}
	canonicalBytes = append(canonicalBytes, '\n')
	if !bytes.Equal(raw, canonicalBytes) {
		return fmt.Errorf("snapshot file is not canonical, run update mode")
	}

	fmt.Printf("snapshot valid: %s (models=%d)\n", path, len(snapshot.Models))
	return nil
}

func runUpdateSupplemental(snapshotPath string, supplementalPath string, timeout time.Duration) error {
	snapshot, err := modelcards.LoadSnapshotFile(snapshotPath)
	if err != nil {
		return err
	}

	supplemental, err := loadSupplementalOrDefault(supplementalPath)
	if err != nil {
		return err
	}

	source := modelcards.NewOpenRouterSource(timeout)
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	liveCards, err := source.Fetch(ctx)
	if err != nil {
		return err
	}

	baseSnapshotIDs := make(map[string]struct{}, len(snapshot.Models))
	for _, model := range snapshot.Models {
		key := normalizeModelID(model.SourceModelID)
		if key == "" {
			continue
		}
		baseSnapshotIDs[key] = struct{}{}
	}

	modelIndexBySourceID := make(map[string]int, len(supplemental.Models))
	for i, model := range supplemental.Models {
		key := normalizeModelID(model.SourceModelID)
		if key == "" {
			continue
		}
		modelIndexBySourceID[key] = i
	}

	added := 0
	updated := 0
	for _, liveCard := range liveCards {
		sourceModelIDKey := normalizeModelID(liveCard.SourceModelID)
		if sourceModelIDKey == "" {
			continue
		}
		if _, exists := baseSnapshotIDs[sourceModelIDKey]; exists {
			continue
		}

		next := supplementalModelFromCard(liveCard)
		existingIdx, exists := modelIndexBySourceID[sourceModelIDKey]
		if !exists {
			supplemental.Models = append(supplemental.Models, next)
			modelIndexBySourceID[sourceModelIDKey] = len(supplemental.Models) - 1
			added++
			continue
		}

		// Keep model keys stable for pre-existing manual records.
		next.ModelKey = strings.TrimSpace(supplemental.Models[existingIdx].ModelKey)
		if !reflect.DeepEqual(supplemental.Models[existingIdx], next) {
			supplemental.Models[existingIdx] = next
			updated++
		}
	}

	supplemental.CapturedAt = time.Now().UTC()
	if supplemental.SchemaVersion == 0 {
		supplemental.SchemaVersion = 1
	}
	modelcards.CanonicalizeSupplemental(&supplemental)
	supplemental.ChecksumSHA256 = modelcards.ComputeSupplementalChecksum(supplemental.Models, supplemental.Patches)

	if err := modelcards.ValidateSupplementalAgainstSnapshot(*snapshot, &supplemental); err != nil {
		return err
	}
	if err := modelcards.WriteSupplementalFile(supplementalPath, supplemental); err != nil {
		return err
	}

	fmt.Printf(
		"wrote supplemental catalog to %s (models=%d patches=%d added=%d updated=%d)\n",
		supplementalPath,
		len(supplemental.Models),
		len(supplemental.Patches),
		added,
		updated,
	)
	return nil
}

func runCheckSupplemental(snapshotPath string, supplementalPath string) error {
	if err := modelcards.CheckSupplementalFileCanonical(supplementalPath); err != nil {
		return err
	}

	snapshot, err := modelcards.LoadSnapshotFile(snapshotPath)
	if err != nil {
		return err
	}
	supplemental, err := modelcards.LoadSupplementalFile(supplementalPath)
	if err != nil {
		return err
	}
	if err := modelcards.ValidateSupplementalAgainstSnapshot(*snapshot, supplemental); err != nil {
		return err
	}

	fmt.Printf(
		"supplemental valid: %s (models=%d patches=%d)\n",
		supplementalPath,
		len(supplemental.Models),
		len(supplemental.Patches),
	)
	return nil
}

func loadSupplementalOrDefault(path string) (modelcards.SupplementalCatalog, error) {
	_, statErr := os.Stat(path)
	if statErr != nil {
		if errors.Is(statErr, os.ErrNotExist) {
			return modelcards.SupplementalCatalog{
				CapturedAt:    time.Now().UTC(),
				SchemaVersion: 1,
				Models:        []modelcards.SupplementalModel{},
				Patches:       []modelcards.SupplementalPatch{},
			}, nil
		}
		return modelcards.SupplementalCatalog{}, statErr
	}

	supplemental, err := modelcards.LoadSupplementalFile(path)
	if err != nil {
		return modelcards.SupplementalCatalog{}, err
	}
	return *supplemental, nil
}

func supplementalModelFromCard(card modelcards.Card) modelcards.SupplementalModel {
	return modelcards.SupplementalModel{
		ModelKey:            fmt.Sprintf("%s:%s", modelcards.SourceSupplemental, strings.TrimSpace(card.SourceModelID)),
		SourceModelID:       strings.TrimSpace(card.SourceModelID),
		CanonicalSlug:       strings.TrimSpace(card.CanonicalSlug),
		Name:                strings.TrimSpace(card.Name),
		Provider:            strings.TrimSpace(card.Provider),
		Description:         strings.TrimSpace(card.Description),
		ContextLength:       cloneIntPtr(card.ContextLength),
		Modality:            strings.TrimSpace(card.Modality),
		InputModalities:     append([]string(nil), card.InputModalities...),
		OutputModalities:    append([]string(nil), card.OutputModalities...),
		SupportedParameters: append([]string(nil), card.SupportedParameters...),
		Tokenizer:           strings.TrimSpace(card.Tokenizer),
		Pricing:             clonePricing(card.Pricing),
		IsFree:              card.IsFree,
		TopProvider:         cloneTopProvider(card.TopProvider),
		ExpiresAt:           cloneTimePtr(card.ExpiresAt),
	}
}

func normalizeModelID(value string) string {
	return strings.TrimSpace(strings.ToLower(value))
}

func clonePricing(value modelcards.Pricing) modelcards.Pricing {
	return modelcards.Pricing{
		PromptUSDPerToken:          cloneFloatPtr(value.PromptUSDPerToken),
		CompletionUSDPerToken:      cloneFloatPtr(value.CompletionUSDPerToken),
		RequestUSD:                 cloneFloatPtr(value.RequestUSD),
		ImageUSD:                   cloneFloatPtr(value.ImageUSD),
		WebSearchUSD:               cloneFloatPtr(value.WebSearchUSD),
		InputCacheReadUSDPerToken:  cloneFloatPtr(value.InputCacheReadUSDPerToken),
		InputCacheWriteUSDPerToken: cloneFloatPtr(value.InputCacheWriteUSDPerToken),
	}
}

func cloneTopProvider(value modelcards.TopProvider) modelcards.TopProvider {
	out := modelcards.TopProvider{
		ContextLength:       cloneIntPtr(value.ContextLength),
		MaxCompletionTokens: cloneIntPtr(value.MaxCompletionTokens),
	}
	if value.IsModerated != nil {
		isModerated := *value.IsModerated
		out.IsModerated = &isModerated
	}
	return out
}

func cloneFloatPtr(value *float64) *float64 {
	if value == nil {
		return nil
	}
	v := *value
	return &v
}

func cloneIntPtr(value *int) *int {
	if value == nil {
		return nil
	}
	v := *value
	return &v
}

func cloneTimePtr(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	v := value.UTC()
	return &v
}
