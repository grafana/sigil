package followup

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/grafana/sigil/sigil/internal/eval/evaluators/judges"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
)

const (
	defaultMaxTokens  = 4096
	defaultTimeout    = 2 * time.Minute
	maxMessageCharLen = 200_000
)

// GenerationReader loads all protobuf generations for a conversation.
type GenerationReader interface {
	ListConversationGenerations(ctx context.Context, tenantID, conversationID string) ([]*sigilv1.Generation, error)
}

type Request struct {
	ConversationID string
	GenerationID   string
	Message        string
	Model          string // optional "provider/model" override
}

type Response struct {
	Text  string `json:"response"`
	Model string `json:"model"`
}

type Service struct {
	discovery    *judges.Discovery
	defaultModel string // "provider/model"
}

func NewService(discovery *judges.Discovery, defaultModel string) *Service {
	return &Service{
		discovery:    discovery,
		defaultModel: defaultModel,
	}
}

func (s *Service) Followup(ctx context.Context, generations []*sigilv1.Generation, req Request) (Response, error) {
	if strings.TrimSpace(req.Message) == "" {
		return Response{}, errors.New("message is required")
	}
	if strings.TrimSpace(req.GenerationID) == "" {
		return Response{}, errors.New("generation_id is required")
	}
	if len(generations) == 0 {
		return Response{}, errors.New("no generations found")
	}

	sorted := sortGenerationsByTime(generations)
	targetIdx := findGenerationIndex(sorted, req.GenerationID)
	if targetIdx < 0 {
		return Response{}, fmt.Errorf("generation %q not found in conversation", req.GenerationID)
	}

	upToTarget := sorted[:targetIdx+1]
	targetGen := upToTarget[targetIdx]
	conversationLog := buildConversationLog(upToTarget)

	providerID, modelName, err := s.resolveModel(targetGen, req.Model)
	if err != nil {
		return Response{}, fmt.Errorf("resolve model: %w", err)
	}

	client, ok := s.discovery.Client(providerID)
	if !ok {
		return Response{}, fmt.Errorf("judge provider %q is not configured", providerID)
	}

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	judgeReq := judges.JudgeRequest{
		SystemPrompt: strings.TrimSpace(targetGen.GetSystemPrompt()),
		UserPrompt:   buildFollowupUserPrompt(conversationLog, req.Message),
		Model:        modelName,
		MaxTokens:    defaultMaxTokens,
		Temperature:  0.3,
	}

	resp, err := client.Judge(ctx, judgeReq)
	if err != nil {
		return Response{}, fmt.Errorf("judge call: %w", err)
	}

	return Response{
		Text:  resp.Text,
		Model: providerID + "/" + resp.Model,
	}, nil
}

func (s *Service) resolveModel(targetGen *sigilv1.Generation, override string) (providerID, modelName string, err error) {
	if override != "" {
		parts := strings.SplitN(override, "/", 2)
		if len(parts) == 2 {
			if _, ok := s.discovery.Client(parts[0]); ok {
				return parts[0], parts[1], nil
			}
		}
	}

	if model := targetGen.GetModel(); model != nil {
		provider := strings.TrimSpace(model.GetProvider())
		name := strings.TrimSpace(model.GetName())
		if provider != "" && name != "" {
			if _, ok := s.discovery.Client(provider); ok {
				return provider, name, nil
			}
		}
	}

	if s.defaultModel == "" {
		return "", "", errors.New("no judge provider available for the generation's model and no default configured")
	}
	parts := strings.SplitN(s.defaultModel, "/", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("invalid default model format %q", s.defaultModel)
	}
	return parts[0], parts[1], nil
}

func sortGenerationsByTime(generations []*sigilv1.Generation) []*sigilv1.Generation {
	out := make([]*sigilv1.Generation, len(generations))
	copy(out, generations)
	sort.SliceStable(out, func(i, j int) bool {
		iTime := generationTime(out[i])
		jTime := generationTime(out[j])
		return iTime.Before(jTime)
	})
	return out
}

func generationTime(g *sigilv1.Generation) time.Time {
	if ts := g.GetStartedAt(); ts != nil {
		return ts.AsTime()
	}
	if ts := g.GetCompletedAt(); ts != nil {
		return ts.AsTime()
	}
	return time.Time{}
}

func findGenerationIndex(sorted []*sigilv1.Generation, id string) int {
	for i, g := range sorted {
		if g.GetId() == id {
			return i
		}
	}
	return -1
}
