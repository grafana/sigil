package object

import (
	"context"
	"testing"

	"github.com/thanos-io/objstore"
)

func BenchmarkEncodeBlock(b *testing.B) {
	block := benchmarkBlock(b, "bench-encode", 200)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, _, _, err := EncodeBlock(block); err != nil {
			b.Fatalf("encode block: %v", err)
		}
	}
}

func BenchmarkDecodeBlock(b *testing.B) {
	block := benchmarkBlock(b, "bench-decode", 200)
	dataBytes, _, _, err := EncodeBlock(block)
	if err != nil {
		b.Fatalf("encode block: %v", err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := DecodeData(dataBytes); err != nil {
			b.Fatalf("decode block: %v", err)
		}
	}
}

func BenchmarkReadIndex(b *testing.B) {
	ctx := context.Background()
	store := NewStoreWithBucket("sigil", objstore.NewInMemBucket())
	block := benchmarkBlock(b, "bench-read-index", 200)
	if err := store.WriteBlock(ctx, "tenant-bench", block); err != nil {
		b.Fatalf("write block: %v", err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := store.ReadIndex(ctx, "tenant-bench", block.ID); err != nil {
			b.Fatalf("read index: %v", err)
		}
	}
}

func BenchmarkReadGenerations(b *testing.B) {
	ctx := context.Background()
	store := NewStoreWithBucket("sigil", objstore.NewInMemBucket())
	block := benchmarkBlock(b, "bench-read-generations", 200)
	if err := store.WriteBlock(ctx, "tenant-bench", block); err != nil {
		b.Fatalf("write block: %v", err)
	}
	index, err := store.ReadIndex(ctx, "tenant-bench", block.ID)
	if err != nil {
		b.Fatalf("read index: %v", err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := store.ReadGenerations(ctx, "tenant-bench", block.ID, index.Entries); err != nil {
			b.Fatalf("read generations: %v", err)
		}
	}
}
