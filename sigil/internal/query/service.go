package query

import "time"

type Conversation struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Completion struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversationId"`
	Model          string    `json:"model"`
	CreatedAt      time.Time `json:"createdAt"`
}

type Trace struct {
	ID            string   `json:"id"`
	GenerationIDs []string `json:"generationIds"`
}

type Service struct{}

func NewService() *Service {
	return &Service{}
}

func (s *Service) ListConversations() []Conversation {
	return []Conversation{{
		ID:        "c-bootstrap",
		Title:     "Sigil bootstrap conversation",
		UpdatedAt: time.Now().UTC(),
	}}
}

func (s *Service) GetConversation(id string) Conversation {
	return Conversation{
		ID:        id,
		Title:     "Sigil conversation placeholder",
		UpdatedAt: time.Now().UTC(),
	}
}

func (s *Service) ListCompletions() []Completion {
	return []Completion{{
		ID:             "cmp-bootstrap",
		ConversationID: "c-bootstrap",
		Model:          "placeholder-model",
		CreatedAt:      time.Now().UTC(),
	}}
}

func (s *Service) GetTrace(id string) Trace {
	return Trace{ID: id, GenerationIDs: []string{"gen-bootstrap"}}
}
