package storage

// TenantShard represents a backlog-bearing shard unit selected by compactor discovery.
type TenantShard struct {
	TenantID string
	ShardID  int
	Backlog  int
}

// ShardPredicate is the deterministic time-window shard mapping used in SQL predicates.
type ShardPredicate struct {
	ShardWindowSeconds int
	ShardCount         int
	ShardID            int
}
