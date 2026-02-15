package object

import (
	"testing"
	"time"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestEncodeDecodeBlockRoundTrip(t *testing.T) {
	block := testBlock(t, "block-roundtrip", 4)

	dataBytes, indexBytes, encodedIndex, err := EncodeBlock(block)
	if err != nil {
		t.Fatalf("encode block: %v", err)
	}
	if len(encodedIndex.Entries) != 4 {
		t.Fatalf("expected 4 index entries, got %d", len(encodedIndex.Entries))
	}

	decodedIndex, err := DecodeIndex(indexBytes)
	if err != nil {
		t.Fatalf("decode index: %v", err)
	}
	if len(decodedIndex.Entries) != len(encodedIndex.Entries) {
		t.Fatalf("index entry count mismatch: expected %d got %d", len(encodedIndex.Entries), len(decodedIndex.Entries))
	}

	generations, err := DecodeData(dataBytes)
	if err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if len(generations) != 4 {
		t.Fatalf("expected 4 generations, got %d", len(generations))
	}
	for i := range generations {
		expectedID := "gen-" + string(rune('a'+i))
		if generations[i].GetId() != expectedID {
			t.Fatalf("unexpected generation id at %d: expected %q got %q", i, expectedID, generations[i].GetId())
		}
		if generations[i].MaxTokens == nil || *generations[i].MaxTokens != int64(128+i) {
			t.Fatalf("unexpected max_tokens at %d", i)
		}
		if generations[i].Temperature == nil || *generations[i].Temperature != float64(i+1)/10.0 {
			t.Fatalf("unexpected temperature at %d", i)
		}
		if generations[i].TopP == nil || *generations[i].TopP != float64(i+5)/10.0 {
			t.Fatalf("unexpected top_p at %d", i)
		}
		if generations[i].ToolChoice == nil || *generations[i].ToolChoice != "auto" {
			t.Fatalf("unexpected tool_choice at %d", i)
		}
		expectedThinking := i%2 == 0
		if generations[i].ThinkingEnabled == nil || *generations[i].ThinkingEnabled != expectedThinking {
			t.Fatalf("unexpected thinking_enabled at %d", i)
		}
	}
}

func TestFindEntriesByConversationAndGeneration(t *testing.T) {
	block := testBlock(t, "block-seek", 4)
	_, _, index, err := EncodeBlock(block)
	if err != nil {
		t.Fatalf("encode block: %v", err)
	}

	convEntries := FindEntriesByConversationID(index, "conv-1")
	if len(convEntries) != 2 {
		t.Fatalf("expected 2 conversation entries, got %d", len(convEntries))
	}

	genEntries := FindEntriesByGenerationID(index, "gen-c")
	if len(genEntries) != 1 {
		t.Fatalf("expected 1 generation entry, got %d", len(genEntries))
	}
}

func testBlock(t *testing.T, blockID string, count int) *storage.Block {
	t.Helper()

	base := time.Date(2026, 2, 12, 19, 0, 0, 0, time.UTC)
	records := make([]storage.GenerationRecord, 0, count)
	for i := 0; i < count; i++ {
		generationID := "gen-" + string(rune('a'+i))
		conversationID := "conv-1"
		if i%2 == 1 {
			conversationID = "conv-2"
		}

		generation := &sigilv1.Generation{
			Id:              generationID,
			ConversationId:  conversationID,
			Mode:            sigilv1.GenerationMode_GENERATION_MODE_SYNC,
			Model:           &sigilv1.ModelRef{Provider: "openai", Name: "gpt-5"},
			StartedAt:       timestamppb.New(base.Add(time.Duration(i) * time.Minute)),
			CompletedAt:     timestamppb.New(base.Add(time.Duration(i)*time.Minute + time.Second)),
			MaxTokens:       proto.Int64(int64(128 + i)),
			Temperature:     proto.Float64(float64(i+1) / 10.0),
			TopP:            proto.Float64(float64(i+5) / 10.0),
			ToolChoice:      proto.String("auto"),
			ThinkingEnabled: proto.Bool(i%2 == 0),
		}
		payload, err := proto.Marshal(generation)
		if err != nil {
			t.Fatalf("marshal generation %q: %v", generationID, err)
		}

		records = append(records, storage.GenerationRecord{
			GenerationID:   generationID,
			ConversationID: conversationID,
			CreatedAt:      generation.GetCompletedAt().AsTime().UTC(),
			Payload:        payload,
		})
	}

	return &storage.Block{
		ID:          blockID,
		Generations: records,
	}
}
