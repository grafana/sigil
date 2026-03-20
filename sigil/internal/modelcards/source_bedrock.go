package modelcards

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/bedrock"
	bedrocktypes "github.com/aws/aws-sdk-go-v2/service/bedrock/types"
)

// BedrockModelLister abstracts the Bedrock ListFoundationModels call for testing.
type BedrockModelLister interface {
	ListFoundationModels(ctx context.Context, params *bedrock.ListFoundationModelsInput, optFns ...func(*bedrock.Options)) (*bedrock.ListFoundationModelsOutput, error)
}

type BedrockSource struct {
	client BedrockModelLister
}

func NewBedrockSource(client BedrockModelLister) *BedrockSource {
	return &BedrockSource{
		client: client,
	}
}

func (s *BedrockSource) Name() string {
	return SourceBedrock
}

func (s *BedrockSource) Fetch(ctx context.Context) ([]Card, error) {
	out, err := s.client.ListFoundationModels(ctx, &bedrock.ListFoundationModelsInput{
		ByOutputModality: bedrocktypes.ModelModalityText,
	})
	if err != nil {
		return nil, fmt.Errorf("bedrock ListFoundationModels: %w", err)
	}

	now := time.Now().UTC()
	cards := make([]Card, 0, len(out.ModelSummaries))

	for _, m := range out.ModelSummaries {
		if !bedrockModelSupportsTextInOut(m) {
			continue
		}
		if !bedrockModelIsOnDemand(m) {
			continue
		}

		modelID := aws.ToString(m.ModelId)
		if modelID == "" {
			continue
		}

		card := Card{
			ModelKey:         modelKey(SourceBedrock, modelID),
			Source:           SourceBedrock,
			SourceModelID:    modelID,
			Name:             bedrockModelName(m),
			Provider:         "bedrock",
			Description:      fmt.Sprintf("%s model available via AWS Bedrock", aws.ToString(m.ProviderName)),
			InputModalities:  bedrockModalities(m.InputModalities),
			OutputModalities: bedrockModalities(m.OutputModalities),
			Modality:         "text->text",
			FirstSeenAt:      now,
			LastSeenAt:       now,
			RefreshedAt:      now,
			RawPayloadJSON:   "{}",
		}
		cards = append(cards, card)
	}

	sort.Slice(cards, func(i, j int) bool {
		return cards[i].ModelKey < cards[j].ModelKey
	})

	return cards, nil
}

func bedrockModelSupportsTextInOut(m bedrocktypes.FoundationModelSummary) bool {
	hasTextInput := false
	for _, mod := range m.InputModalities {
		if mod == bedrocktypes.ModelModalityText {
			hasTextInput = true
			break
		}
	}
	hasTextOutput := false
	for _, mod := range m.OutputModalities {
		if mod == bedrocktypes.ModelModalityText {
			hasTextOutput = true
			break
		}
	}
	return hasTextInput && hasTextOutput
}

func bedrockModelIsOnDemand(m bedrocktypes.FoundationModelSummary) bool {
	for _, t := range m.InferenceTypesSupported {
		if t == bedrocktypes.InferenceTypeOnDemand {
			return true
		}
	}
	return false
}

func bedrockModelName(m bedrocktypes.FoundationModelSummary) string {
	name := aws.ToString(m.ModelName)
	if name != "" {
		return strings.TrimSpace(name)
	}
	return aws.ToString(m.ModelId)
}

func bedrockModalities(mods []bedrocktypes.ModelModality) []string {
	if len(mods) == 0 {
		return nil
	}
	out := make([]string, 0, len(mods))
	for _, m := range mods {
		s := strings.ToLower(string(m))
		if s != "" {
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
