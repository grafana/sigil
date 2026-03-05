package control

import (
	"strings"
	"testing"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

func TestValidateID(t *testing.T) {
	tests := []struct {
		name    string
		id      string
		wantErr string
	}{
		{name: "simple", id: "helpfulness"},
		{name: "dotted", id: "custom.helpfulness"},
		{name: "underscored", id: "my_evaluator"},
		{name: "digits", id: "eval123"},
		{name: "mixed", id: "org.eval_v2.0"},
		{name: "single char", id: "a"},
		{name: "single dot", id: "."},
		{name: "leading dot", id: ".foo"},
		{name: "trailing dot", id: "foo."},
		{name: "space", id: "has space", wantErr: "is invalid"},
		{name: "slash", id: "ns/rule", wantErr: "is invalid"},
		{name: "hyphen", id: "my-evaluator", wantErr: "is invalid"},
		{name: "colon", id: "ns:rule", wantErr: "is invalid"},
		{name: "at sign", id: "user@org", wantErr: "is invalid"},
		{name: "unicode", id: "café", wantErr: "is invalid"},
		{name: "curly brace", id: "a{b}", wantErr: "is invalid"},
		{name: "empty", id: "", wantErr: "is invalid"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateID("test_field", tt.id)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("expected error containing %q, got %v", tt.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestValidateEvaluator_IDCharacters(t *testing.T) {
	base := evalpkg.EvaluatorDefinition{
		TenantID: "tenant",
		Version:  "2026-01-01",
		Kind:     "llm_judge",
		OutputKeys: []evalpkg.OutputKey{
			{Key: "score", Type: evalpkg.ScoreTypeNumber},
		},
	}

	tests := []struct {
		name        string
		evaluatorID string
		wantErr     string
	}{
		{name: "valid dotted", evaluatorID: "custom.helpfulness"},
		{name: "valid underscored", evaluatorID: "my_evaluator"},
		{name: "hyphen rejected", evaluatorID: "my-evaluator", wantErr: "is invalid"},
		{name: "slash rejected", evaluatorID: "ns/evaluator", wantErr: "is invalid"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := base
			e.EvaluatorID = tt.evaluatorID
			err := validateEvaluator(&e)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("expected error containing %q, got %v", tt.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestValidateRule_IDCharacters(t *testing.T) {
	base := evalpkg.RuleDefinition{
		TenantID:     "tenant",
		EvaluatorIDs: []string{"eval.1"},
	}

	tests := []struct {
		name    string
		ruleID  string
		wantErr string
	}{
		{name: "valid dotted", ruleID: "online.helpfulness"},
		{name: "valid underscored", ruleID: "my_rule"},
		{name: "hyphen rejected", ruleID: "my-rule", wantErr: "is invalid"},
		{name: "space rejected", ruleID: "my rule", wantErr: "is invalid"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := base
			r.RuleID = tt.ruleID
			err := validateRule(&r)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("expected error containing %q, got %v", tt.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}
