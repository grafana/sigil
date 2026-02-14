package feedback

import (
	"context"
	"errors"
	"testing"
)

func TestCreateAnnotationRequiresOperatorID(t *testing.T) {
	service := NewService(NewMemoryStore())
	_, _, err := service.CreateAnnotation(context.Background(), "tenant-a", "conv-1", OperatorIdentity{}, CreateConversationAnnotationInput{
		AnnotationID:   "ann-1",
		AnnotationType: AnnotationTypeNote,
	})
	if err == nil || !IsValidationError(err) {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestCreateRatingValidatesRatingValue(t *testing.T) {
	service := NewService(NewMemoryStore())
	_, _, err := service.CreateRating(context.Background(), "tenant-a", "conv-1", CreateConversationRatingInput{
		RatingID: "rat-1",
		Rating:   "BAD",
	})
	if err == nil || !IsValidationError(err) {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestNormalizePaginationHelpers(t *testing.T) {
	limit, err := NormalizeLimit("10")
	if err != nil {
		t.Fatalf("normalize limit: %v", err)
	}
	if limit != 10 {
		t.Fatalf("expected limit 10, got %d", limit)
	}

	cursor, err := NormalizeCursor("42")
	if err != nil {
		t.Fatalf("normalize cursor: %v", err)
	}
	if cursor != 42 {
		t.Fatalf("expected cursor 42, got %d", cursor)
	}

	if _, err := NormalizeCursor("bad"); err == nil {
		t.Fatalf("expected validation error for bad cursor")
	} else {
		var validationErr *ValidationError
		if !errors.As(err, &validationErr) {
			t.Fatalf("expected validation error for bad cursor, got %v", err)
		}
	}
}
