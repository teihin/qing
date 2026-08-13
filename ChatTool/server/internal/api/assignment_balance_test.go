package api

import (
	"database/sql"
	"testing"
	"time"
)

func TestChooseLiveRebalancePair(t *testing.T) {
	older := sql.NullTime{Time: time.Unix(100, 0), Valid: true}
	newer := sql.NullTime{Time: time.Unix(200, 0), Valid: true}

	tests := []struct {
		name         string
		loads        []agentLiveLoad
		wantSourceID int64
		wantTargetID int64
		wantMove     bool
	}{
		{
			name: "two live chats move one to empty agent",
			loads: []agentLiveLoad{
				{ID: 1, LiveConversations: 2, MaxConversations: 8, LastAssignedAt: newer},
				{ID: 2, LiveConversations: 0, MaxConversations: 8},
			},
			wantSourceID: 1,
			wantTargetID: 2,
			wantMove:     true,
		},
		{
			name: "one chat remains stable",
			loads: []agentLiveLoad{
				{ID: 1, LiveConversations: 1, MaxConversations: 8},
				{ID: 2, LiveConversations: 0, MaxConversations: 8},
			},
			wantMove: false,
		},
		{
			name: "oldest idle agent wins target tie",
			loads: []agentLiveLoad{
				{ID: 1, LiveConversations: 3, MaxConversations: 8, LastAssignedAt: newer},
				{ID: 2, LiveConversations: 0, MaxConversations: 8, LastAssignedAt: older},
				{ID: 3, LiveConversations: 0, MaxConversations: 8, LastAssignedAt: newer},
			},
			wantSourceID: 1,
			wantTargetID: 2,
			wantMove:     true,
		},
		{
			name: "full agent is skipped as target",
			loads: []agentLiveLoad{
				{ID: 1, LiveConversations: 4, MaxConversations: 8},
				{ID: 2, LiveConversations: 0, MaxConversations: 0},
				{ID: 3, LiveConversations: 1, MaxConversations: 8},
			},
			wantSourceID: 1,
			wantTargetID: 3,
			wantMove:     true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			source, target, move := chooseLiveRebalancePair(test.loads)
			if move != test.wantMove {
				t.Fatalf("chooseLiveRebalancePair() move = %v, want %v", move, test.wantMove)
			}
			if move && (source.ID != test.wantSourceID || target.ID != test.wantTargetID) {
				t.Fatalf("chooseLiveRebalancePair() = source %d target %d, want source %d target %d", source.ID, target.ID, test.wantSourceID, test.wantTargetID)
			}
		})
	}
}
