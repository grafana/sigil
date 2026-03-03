package query

import "github.com/grafana/sigil/sigil/pkg/searchcore"

type FilterRoute = searchcore.FilterRoute

const (
	FilterRouteTempo FilterRoute = searchcore.FilterRouteTempo
	FilterRouteMySQL FilterRoute = searchcore.FilterRouteMySQL
)

type FilterOperator = searchcore.FilterOperator

const (
	FilterOperatorEqual              FilterOperator = searchcore.FilterOperatorEqual
	FilterOperatorNotEqual           FilterOperator = searchcore.FilterOperatorNotEqual
	FilterOperatorGreaterThan        FilterOperator = searchcore.FilterOperatorGreaterThan
	FilterOperatorLessThan           FilterOperator = searchcore.FilterOperatorLessThan
	FilterOperatorGreaterThanOrEqual FilterOperator = searchcore.FilterOperatorGreaterThanOrEqual
	FilterOperatorLessThanOrEqual    FilterOperator = searchcore.FilterOperatorLessThanOrEqual
	FilterOperatorRegex              FilterOperator = searchcore.FilterOperatorRegex
)

type FilterTerm = searchcore.FilterTerm

type ParsedFilters = searchcore.ParsedFilters

type SelectField = searchcore.SelectField

type SearchTag = searchcore.SearchTag

func ParseFilterExpression(expression string) (ParsedFilters, error) {
	return searchcore.ParseFilterExpression(expression)
}

func NormalizeSelectFields(keys []string) ([]SelectField, error) {
	return searchcore.NormalizeSelectFields(keys)
}

func BuildTraceQL(parsed ParsedFilters, selectFields []SelectField) (string, error) {
	return searchcore.BuildTraceQL(parsed, selectFields)
}

func WellKnownSearchTags() []SearchTag {
	return searchcore.WellKnownSearchTags()
}

func resolveTagKeyForTempo(rawKey string) (string, bool, error) {
	return searchcore.ResolveTagKeyForTempo(rawKey)
}
