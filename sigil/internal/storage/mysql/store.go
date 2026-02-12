package mysql

import (
	"log/slog"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

type WALStore struct {
	db     *gorm.DB
	logger *slog.Logger
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
		db:     db,
		logger: slog.Default(),
	}, nil
}

func (s *WALStore) DB() *gorm.DB {
	return s.db
}
