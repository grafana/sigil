package mysql

import (
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
		evalEnqueueEnable: true,
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
