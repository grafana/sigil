package modelcards

import (
	"context"
	"errors"
	"time"
)

var ErrNotFound = errors.New("model card not found")

type Store interface {
	AutoMigrate(ctx context.Context) error

	UpsertCards(ctx context.Context, source string, refreshedAt time.Time, cards []Card) (int, error)
	ListCards(ctx context.Context, params ListParams) ([]Card, bool, error)
	GetCardByModelKey(ctx context.Context, modelKey string) (*Card, error)
	GetCardBySourceID(ctx context.Context, source string, sourceModelID string) (*Card, error)
	CountCards(ctx context.Context) (int64, error)
	LatestRefreshedAt(ctx context.Context) (*time.Time, error)

	RecordRefreshRun(ctx context.Context, run RefreshRun) error
	LatestRefreshRun(ctx context.Context, source string) (*RefreshRun, error)

	TryAcquireLease(ctx context.Context, scopeKey string, ownerID string, now time.Time, ttl time.Duration) (bool, error)
	RenewLease(ctx context.Context, scopeKey string, ownerID string, now time.Time, ttl time.Duration) (bool, error)
	ReleaseLease(ctx context.Context, scopeKey string, ownerID string) error
}
