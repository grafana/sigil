package modelcards

import (
	"context"
	"fmt"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/bedrock"
	bedrocktypes "github.com/aws/aws-sdk-go-v2/service/bedrock/types"
)

type stubBedrockClient struct {
	models []bedrocktypes.FoundationModelSummary
	err    error
}

func (s *stubBedrockClient) ListFoundationModels(_ context.Context, _ *bedrock.ListFoundationModelsInput, _ ...func(*bedrock.Options)) (*bedrock.ListFoundationModelsOutput, error) {
	if s.err != nil {
		return nil, s.err
	}
	return &bedrock.ListFoundationModelsOutput{
		ModelSummaries: s.models,
	}, nil
}

func TestBedrockSourceFetch(t *testing.T) {
	client := &stubBedrockClient{
		models: []bedrocktypes.FoundationModelSummary{
			{
				ModelId:      aws.String("anthropic.claude-3-5-haiku-20241022-v1:0"),
				ModelName:    aws.String("Claude 3.5 Haiku"),
				ProviderName: aws.String("Anthropic"),
				InputModalities: []bedrocktypes.ModelModality{
					bedrocktypes.ModelModalityText,
					bedrocktypes.ModelModalityImage,
				},
				OutputModalities: []bedrocktypes.ModelModality{
					bedrocktypes.ModelModalityText,
				},
				InferenceTypesSupported: []bedrocktypes.InferenceType{
					bedrocktypes.InferenceTypeOnDemand,
				},
			},
			{
				ModelId:      aws.String("amazon.titan-embed-text-v2:0"),
				ModelName:    aws.String("Titan Text Embeddings V2"),
				ProviderName: aws.String("Amazon"),
				InputModalities: []bedrocktypes.ModelModality{
					bedrocktypes.ModelModalityText,
				},
				OutputModalities: []bedrocktypes.ModelModality{
					bedrocktypes.ModelModalityEmbedding,
				},
				InferenceTypesSupported: []bedrocktypes.InferenceType{
					bedrocktypes.InferenceTypeOnDemand,
				},
			},
			{
				ModelId:      aws.String("stability.stable-diffusion-xl-v1"),
				ModelName:    aws.String("Stable Diffusion XL"),
				ProviderName: aws.String("Stability AI"),
				InputModalities: []bedrocktypes.ModelModality{
					bedrocktypes.ModelModalityText,
				},
				OutputModalities: []bedrocktypes.ModelModality{
					bedrocktypes.ModelModalityImage,
				},
				InferenceTypesSupported: []bedrocktypes.InferenceType{
					bedrocktypes.InferenceTypeOnDemand,
				},
			},
			{
				ModelId:      aws.String("meta.llama3-70b-instruct-v1:0"),
				ModelName:    aws.String("Llama 3 70B Instruct"),
				ProviderName: aws.String("Meta"),
				InputModalities: []bedrocktypes.ModelModality{
					bedrocktypes.ModelModalityText,
				},
				OutputModalities: []bedrocktypes.ModelModality{
					bedrocktypes.ModelModalityText,
				},
				InferenceTypesSupported: []bedrocktypes.InferenceType{
					bedrocktypes.InferenceTypeOnDemand,
					bedrocktypes.InferenceTypeProvisioned,
				},
			},
			// Provisioned-only model: should be excluded.
			{
				ModelId:      aws.String("cohere.command-r-plus-v1:0"),
				ModelName:    aws.String("Command R+"),
				ProviderName: aws.String("Cohere"),
				InputModalities: []bedrocktypes.ModelModality{
					bedrocktypes.ModelModalityText,
				},
				OutputModalities: []bedrocktypes.ModelModality{
					bedrocktypes.ModelModalityText,
				},
				InferenceTypesSupported: []bedrocktypes.InferenceType{
					bedrocktypes.InferenceTypeProvisioned,
				},
			},
		},
	}

	src := NewBedrockSource(client, "us-east-1")

	if src.Name() != SourceBedrock {
		t.Fatalf("expected source name %q, got %q", SourceBedrock, src.Name())
	}

	cards, err := src.Fetch(context.Background())
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}

	// Claude (text+image->text, on-demand) and Llama (text->text, on-demand+provisioned)
	// should be included. Titan embeddings (text->embedding), Stable Diffusion
	// (text->image), and Command R+ (provisioned-only) should be excluded.
	if len(cards) != 2 {
		t.Fatalf("expected 2 cards, got %d: %v", len(cards), cardKeys(cards))
	}

	expectedKeys := []string{
		"bedrock:anthropic.claude-3-5-haiku-20241022-v1:0",
		"bedrock:meta.llama3-70b-instruct-v1:0",
	}
	for i, key := range expectedKeys {
		if cards[i].ModelKey != key {
			t.Errorf("card[%d] model_key = %q, want %q", i, cards[i].ModelKey, key)
		}
		if cards[i].Source != SourceBedrock {
			t.Errorf("card[%d] source = %q, want %q", i, cards[i].Source, SourceBedrock)
		}
		if cards[i].Provider != "bedrock" {
			t.Errorf("card[%d] provider = %q, want %q", i, cards[i].Provider, "bedrock")
		}
	}

	if cards[0].Name != "Claude 3.5 Haiku" {
		t.Errorf("card[0] name = %q, want %q", cards[0].Name, "Claude 3.5 Haiku")
	}
}

func TestBedrockSourceFetchError(t *testing.T) {
	client := &stubBedrockClient{err: fmt.Errorf("access denied")}
	src := NewBedrockSource(client, "us-east-1")

	_, err := src.Fetch(context.Background())
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestBedrockSourceEmptyModels(t *testing.T) {
	client := &stubBedrockClient{models: nil}
	src := NewBedrockSource(client, "us-east-1")

	cards, err := src.Fetch(context.Background())
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(cards) != 0 {
		t.Fatalf("expected 0 cards, got %d", len(cards))
	}
}

func TestBedrockSourceSkipsEmptyModelID(t *testing.T) {
	client := &stubBedrockClient{
		models: []bedrocktypes.FoundationModelSummary{
			{
				ModelId:      aws.String(""),
				ModelName:    aws.String("Empty ID Model"),
				ProviderName: aws.String("Test"),
				InputModalities: []bedrocktypes.ModelModality{
					bedrocktypes.ModelModalityText,
				},
				OutputModalities: []bedrocktypes.ModelModality{
					bedrocktypes.ModelModalityText,
				},
				InferenceTypesSupported: []bedrocktypes.InferenceType{
					bedrocktypes.InferenceTypeOnDemand,
				},
			},
		},
	}
	src := NewBedrockSource(client, "us-east-1")

	cards, err := src.Fetch(context.Background())
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(cards) != 0 {
		t.Fatalf("expected 0 cards, got %d", len(cards))
	}
}

func cardKeys(cards []Card) []string {
	keys := make([]string, len(cards))
	for i, c := range cards {
		keys[i] = c.ModelKey
	}
	return keys
}
