package sigil

import (
	"context"
	"testing"
	"time"

	"github.com/go-kit/log"
	"github.com/grafana/sigil/sigil/internal/config"
	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"github.com/grafana/sigil/sigil/internal/storage/mysql"
)

func TestConfigureIngesterEvalEnqueueRespectsEvalWorkerFlag(t *testing.T) {
	testCases := []struct {
		name           string
		evalEnabled    bool
		wantDispatcher bool
		wantEvents     int
	}{
		{
			name:           "disabled",
			evalEnabled:    false,
			wantDispatcher: false,
			wantEvents:     0,
		},
		{
			name:           "enabled",
			evalEnabled:    true,
			wantDispatcher: true,
			wantEvents:     1,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			dsn, cleanup := newTestMySQLDSN(t)
			defer cleanup()

			store, err := mysql.NewWALStore(dsn)
			if err != nil {
				t.Fatalf("create wal store: %v", err)
			}

			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()

			if err := store.AutoMigrate(ctx); err != nil {
				t.Fatalf("auto-migrate wal store: %v", err)
			}

			cfg := testRuntimeConfigWithoutValidation(t, config.TargetIngester)
			cfg.EvalWorkerEnabled = tc.evalEnabled

			dispatcher := configureIngesterEvalEnqueue(cfg, log.NewNopLogger(), store)
			if tc.wantDispatcher && dispatcher == nil {
				t.Fatalf("expected dispatcher to be configured")
			}
			if !tc.wantDispatcher && dispatcher != nil {
				t.Fatalf("expected dispatcher to be disabled")
			}

			errs := store.SaveBatch(ctx, "tenant-a", []*sigilv1.Generation{
				{
					Id: "gen-1",
				},
			})
			if len(errs) != 1 {
				t.Fatalf("expected one save result, got %d", len(errs))
			}
			if errs[0] != nil {
				t.Fatalf("save generation: %v", errs[0])
			}

			events, err := store.ClaimEvalEnqueueEvents(ctx, time.Now().UTC(), 10, time.Minute)
			if err != nil {
				t.Fatalf("claim enqueue events: %v", err)
			}
			if len(events) != tc.wantEvents {
				t.Fatalf("expected %d enqueue events, got %d", tc.wantEvents, len(events))
			}
		})
	}
}
