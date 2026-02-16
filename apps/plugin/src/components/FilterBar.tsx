import React, { useEffect, useMemo } from 'react';
import { Button, InlineField, InlineFieldRow, Input, Stack, Text } from '@grafana/ui';
import type { SearchTag } from '../conversation/types';

export type FilterBarProps = {
  filter: string;
  from: string;
  to: string;
  tags: SearchTag[];
  tagValues: string[];
  loadingTags: boolean;
  loadingValues: boolean;
  onFilterChange: (value: string) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onApply: () => void;
  onRequestTagValues: (tag: string) => void;
};

type FilterChip = {
  id: string;
  label: string;
};

function toDateTimeLocal(value: string): string {
  if (!value) {
    return '';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromDateTimeLocal(value: string): string {
  if (!value) {
    return '';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toISOString();
}

function extractFilterChips(filter: string): FilterChip[] {
  const expression = filter.trim();
  if (expression.length === 0) {
    return [];
  }

  const chips: FilterChip[] = [];
  const matcher = /([^\s]+)\s*(=~|!=|>=|<=|=|>|<)\s*("(?:[^"\\]|\\.)*"|[^\s]+)/g;
  let match: RegExpExecArray | null = matcher.exec(expression);
  while (match !== null) {
    chips.push({ id: `${match.index}-${match[0]}`, label: match[0] });
    match = matcher.exec(expression);
  }
  return chips;
}

function detectLastTagForValueLookup(filter: string): string {
  const matcher = /([^\s]+)\s*(=~|!=|>=|<=|=|>|<)\s*("(?:[^"\\]|\\.)*"|[^\s]*)$/;
  const match = matcher.exec(filter.trim());
  if (!match) {
    return '';
  }
  return match[1]?.trim() ?? '';
}

function appendTagSuggestion(current: string, tag: string): string {
  const trimmedCurrent = current.trim();
  const clause = `${tag} = ""`;
  if (trimmedCurrent.length === 0) {
    return clause;
  }
  return `${trimmedCurrent} ${clause}`;
}

function appendValueSuggestion(current: string, value: string): string {
  const trimmedCurrent = current.trimEnd();
  if (trimmedCurrent.length === 0) {
    return `"${value}"`;
  }
  const matcher = /(=~|!=|>=|<=|=|>|<)\s*("(?:[^"\\]|\\.)*"|[^\s]*)$/;
  if (!matcher.test(trimmedCurrent)) {
    return `${trimmedCurrent} "${value}"`;
  }
  return trimmedCurrent.replace(matcher, (_full, operator) => `${operator} "${value}"`);
}

export default function FilterBar(props: FilterBarProps) {
  const {
    filter,
    from,
    to,
    tags,
    tagValues,
    loadingTags,
    loadingValues,
    onFilterChange,
    onFromChange,
    onToChange,
    onApply,
    onRequestTagValues,
  } = props;

  const chips = useMemo(() => extractFilterChips(filter), [filter]);
  const suggestedTags = useMemo(() => tags.slice(0, 10), [tags]);
  const suggestedValues = useMemo(() => tagValues.slice(0, 10), [tagValues]);

  const activeTag = useMemo(() => detectLastTagForValueLookup(filter), [filter]);

  useEffect(() => {
    if (activeTag.length === 0) {
      return;
    }
    onRequestTagValues(activeTag);
  }, [activeTag, onRequestTagValues]);

  return (
    <Stack direction="column" gap={1}>
      <InlineFieldRow>
        <InlineField label="Filters" grow>
          <Input
            aria-label="conversation filters"
            value={filter}
            onChange={(event) => onFilterChange(event.currentTarget.value)}
            placeholder='model = "gpt-4o" status = error duration > 5s'
            width={90}
          />
        </InlineField>
        <InlineField label="From">
          <input
            aria-label="search from"
            type="datetime-local"
            value={toDateTimeLocal(from)}
            onChange={(event) => onFromChange(fromDateTimeLocal(event.currentTarget.value))}
          />
        </InlineField>
        <InlineField label="To">
          <input
            aria-label="search to"
            type="datetime-local"
            value={toDateTimeLocal(to)}
            onChange={(event) => onToChange(fromDateTimeLocal(event.currentTarget.value))}
          />
        </InlineField>
        <Button aria-label="apply filters" onClick={onApply}>
          Apply
        </Button>
      </InlineFieldRow>

      {chips.length > 0 && (
        <InlineFieldRow>
          {chips.map((chip) => (
            <Text key={chip.id} color="secondary">
              [{chip.label}]
            </Text>
          ))}
        </InlineFieldRow>
      )}

      <InlineFieldRow>
        <Text color="secondary">Keys:</Text>
        {loadingTags && <Text color="secondary">loading…</Text>}
        {!loadingTags &&
          suggestedTags.map((tag) => (
            <Button
              key={tag.key}
              size="sm"
              variant="secondary"
              onClick={() => onFilterChange(appendTagSuggestion(filter, tag.key))}
            >
              {tag.key}
            </Button>
          ))}
      </InlineFieldRow>

      {activeTag.length > 0 && (
        <InlineFieldRow>
          <Text color="secondary">Values for `{activeTag}`:</Text>
          {loadingValues && <Text color="secondary">loading…</Text>}
          {!loadingValues &&
            suggestedValues.map((value) => (
              <Button
                key={value}
                size="sm"
                variant="secondary"
                onClick={() => onFilterChange(appendValueSuggestion(filter, value))}
              >
                {value}
              </Button>
            ))}
        </InlineFieldRow>
      )}
    </Stack>
  );
}
