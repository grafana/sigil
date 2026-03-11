package storage

import (
	"testing"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGenerationMetadataString(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		generation *sigilv1.Generation
		key        string
		want       string
	}{
		{
			name: "nil generation",
			key:  "sigil.user.id",
			want: "",
		},
		{
			name: "trims plain string values",
			generation: generationWithMetadata(map[string]*structpb.Value{
				"sigil.user.id": structpb.NewStringValue(" user-123 "),
			}),
			key:  "sigil.user.id",
			want: "user-123",
		},
		{
			name: "unwraps structured string values",
			generation: generationWithMetadata(map[string]*structpb.Value{
				"user.id": structpb.NewStructValue(&structpb.Struct{Fields: map[string]*structpb.Value{
					"stringValue": structpb.NewStringValue(" legacy-user "),
				}}),
			}),
			key:  "user.id",
			want: "legacy-user",
		},
		{
			name: "missing key",
			generation: generationWithMetadata(map[string]*structpb.Value{
				"sigil.user.id": structpb.NewStringValue("user-123"),
			}),
			key:  "missing",
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := GenerationMetadataString(tt.generation, tt.key); got != tt.want {
				t.Fatalf("GenerationMetadataString() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestGenerationMetadataFirstString(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		generation *sigilv1.Generation
		keys       []string
		want       string
	}{
		{
			name: "nil generation",
			keys: []string{"sigil.user.id", "user.id"},
			want: "",
		},
		{
			name: "uses first key when present",
			generation: generationWithMetadata(map[string]*structpb.Value{
				"sigil.user.id": structpb.NewStringValue(" primary "),
				"user.id":       structpb.NewStringValue("fallback"),
			}),
			keys: []string{"sigil.user.id", "user.id"},
			want: "primary",
		},
		{
			name: "falls back to next key",
			generation: generationWithMetadata(map[string]*structpb.Value{
				"user.id": structpb.NewStringValue(" legacy "),
			}),
			keys: []string{"sigil.user.id", "user.id"},
			want: "legacy",
		},
		{
			name: "skips empty values",
			generation: generationWithMetadata(map[string]*structpb.Value{
				"sigil.user.id": structpb.NewStringValue("   "),
				"user.id":       structpb.NewStringValue("legacy"),
			}),
			keys: []string{"sigil.user.id", "user.id"},
			want: "legacy",
		},
		{
			name: "no keys",
			generation: generationWithMetadata(map[string]*structpb.Value{
				"sigil.user.id": structpb.NewStringValue("primary"),
			}),
			keys: nil,
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := GenerationMetadataFirstString(tt.generation, tt.keys...); got != tt.want {
				t.Fatalf("GenerationMetadataFirstString() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestConversationTitleFromGeneration(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		generation *sigilv1.Generation
		want       string
	}{
		{
			name: "prefers top-level title",
			generation: generationWithMetadata(map[string]*structpb.Value{
				conversationTitleKey: structpb.NewStringValue(" Incident title "),
				"attributes": structpb.NewStructValue(&structpb.Struct{Fields: map[string]*structpb.Value{
					legacyConversationTitleKey: structpb.NewStringValue("legacy title"),
				}}),
			}),
			want: "Incident title",
		},
		{
			name: "falls back to nested legacy attribute title",
			generation: generationWithMetadata(map[string]*structpb.Value{
				"attributes": structpb.NewStructValue(&structpb.Struct{Fields: map[string]*structpb.Value{
					legacyConversationTitleKey: structpb.NewStructValue(&structpb.Struct{Fields: map[string]*structpb.Value{
						"stringValue": structpb.NewStringValue(" Legacy incident "),
					}}),
				}}),
			}),
			want: "Legacy incident",
		},
		{
			name: "does not read title from output payload",
			generation: &sigilv1.Generation{
				Output: []*sigilv1.Message{
					{
						Role: sigilv1.MessageRole_MESSAGE_ROLE_ASSISTANT,
						Parts: []*sigilv1.Part{
							{Payload: &sigilv1.Part_Text{Text: "```json\n{\"title\":\"Understanding data shape\",\"category\":\"Learn\"}\n```"}},
						},
					},
				},
			},
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := ConversationTitleFromGeneration(tt.generation); got != tt.want {
				t.Fatalf("ConversationTitleFromGeneration() = %q, want %q", got, tt.want)
			}
		})
	}
}

func generationWithMetadata(fields map[string]*structpb.Value) *sigilv1.Generation {
	return &sigilv1.Generation{
		Metadata: &structpb.Struct{Fields: fields},
	}
}
