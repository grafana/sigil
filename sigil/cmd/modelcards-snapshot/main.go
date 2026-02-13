package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/grafana/sigil/sigil/internal/modelcards"
)

func main() {
	mode := flag.String("mode", "check", "mode: update|check")
	output := flag.String("output", "./internal/modelcards/fallback/openrouter_models.v1.json", "snapshot output path")
	timeout := flag.Duration("timeout", 30*time.Second, "live fetch timeout for update mode")
	flag.Parse()

	switch *mode {
	case "update":
		if err := runUpdate(*output, *timeout); err != nil {
			fmt.Fprintf(os.Stderr, "modelcards snapshot update failed: %v\n", err)
			os.Exit(1)
		}
	case "check":
		if err := runCheck(*output); err != nil {
			fmt.Fprintf(os.Stderr, "modelcards snapshot check failed: %v\n", err)
			os.Exit(1)
		}
	default:
		fmt.Fprintf(os.Stderr, "unsupported mode %q\n", *mode)
		os.Exit(1)
	}
}

func runUpdate(output string, timeout time.Duration) error {
	source := modelcards.NewOpenRouterSource(timeout)
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cards, err := source.Fetch(ctx)
	if err != nil {
		return err
	}
	snapshot := modelcards.SnapshotFromCards(source.Name(), time.Now().UTC(), cards)
	if err := modelcards.WriteSnapshotFile(output, snapshot); err != nil {
		return err
	}
	fmt.Printf("wrote %d model cards to %s\n", len(snapshot.Models), output)
	return nil
}

func runCheck(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	snapshot, err := modelcards.LoadSnapshotFile(path)
	if err != nil {
		return err
	}

	canonical := *snapshot
	modelcards.CanonicalizeSnapshot(&canonical)
	canonical.ChecksumSHA256 = modelcards.ComputeSnapshotChecksum(canonical.Models)
	canonicalBytes, err := json.MarshalIndent(canonical, "", "  ")
	if err != nil {
		return err
	}
	canonicalBytes = append(canonicalBytes, '\n')
	if !bytes.Equal(raw, canonicalBytes) {
		return fmt.Errorf("snapshot file is not canonical, run update mode")
	}

	fmt.Printf("snapshot valid: %s (models=%d)\n", path, len(snapshot.Models))
	return nil
}
