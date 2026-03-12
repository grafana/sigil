package mysql

import (
	"context"
	"log/slog"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

type WALStore struct {
	db                *gorm.DB
	logger            *slog.Logger
	evalHook          EvalHook
	evalEnqueueEnable bool
	writeHealth       *walWriteHealth
}

func NewWALStore(dsn string) (*WALStore, error) {
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		NowFunc: func() time.Time {
			return time.Now().UTC()
		},
	})
	if err != nil {
		return nil, err
	}

	return &WALStore{
		db:                db,
		logger:            slog.Default(),
		evalEnqueueEnable: false,
		writeHealth:       newWALWriteHealth(),
	}, nil
}

func (s *WALStore) DB() *gorm.DB {
	return s.db
}

func (s *WALStore) SetEvalHook(hook EvalHook) {
	s.evalHook = hook
}

func (s *WALStore) SetEvalEnqueueEnabled(enabled bool) {
	s.evalEnqueueEnable = enabled
}

func (s *WALStore) WALWriteReady(_ context.Context) error {
	if s == nil || s.writeHealth == nil {
		return nil
	}
	return s.writeHealth.Ready()
}
