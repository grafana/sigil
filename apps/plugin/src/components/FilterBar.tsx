import React, { useCallback, useEffect, useMemo } from 'react';
import { dateTime, makeTimeRange, type TimeRange } from '@grafana/data';
import { FilterPill, Input, Spinner, Stack, Tag, Text, TimeRangePicker, ToolbarButton } from '@grafana/ui';
import type { SearchTag } from '../conversation/types';

export type FilterBarProps = {
  filter: string;
  timeRange: TimeRange;
  tags: SearchTag[];
  tagValues: string[];
  loadingTags: boolean;
  loadingValues: boolean;
  onFilterChange: (value: string) => void;
  onTimeRangeChange: (timeRange: TimeRange) => void;
  onApply: () => void;
  onRequestTagValues: (tag: string) => void;
};

type FilterChip = {
  id: string;
  label: string;
};

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
    timeRange,
    tags,
    tagValues,
    loadingTags,
    loadingValues,
    onFilterChange,
    onTimeRangeChange,
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

  const onMoveBackward = useCallback(() => {
    const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
    const half = Math.round(diff / 2);
    onTimeRangeChange(
      makeTimeRange(dateTime(timeRange.from.valueOf() - half), dateTime(timeRange.to.valueOf() - half))
    );
  }, [timeRange, onTimeRangeChange]);

  const onMoveForward = useCallback(() => {
    const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
    const half = Math.round(diff / 2);
    onTimeRangeChange(
      makeTimeRange(dateTime(timeRange.from.valueOf() + half), dateTime(timeRange.to.valueOf() + half))
    );
  }, [timeRange, onTimeRangeChange]);

  const onZoom = useCallback(() => {
    const diff = timeRange.to.valueOf() - timeRange.from.valueOf();
    const half = Math.round(diff / 2);
    onTimeRangeChange(
      makeTimeRange(dateTime(timeRange.from.valueOf() - half), dateTime(timeRange.to.valueOf() + half))
    );
  }, [timeRange, onTimeRangeChange]);

  return (
    <Stack direction="column" gap={1}>
      <Stack direction="row" gap={1} alignItems="center" wrap="wrap">
        <div style={{ flexGrow: 1 }}>
          <Input
            aria-label="conversation filters"
            value={filter}
            onChange={(event) => onFilterChange(event.currentTarget.value)}
            placeholder='model = "gpt-4o" status = error duration > 5s'
          />
        </div>
        <TimeRangePicker
          value={timeRange}
          onChange={onTimeRangeChange}
          onChangeTimeZone={() => {}}
          onMoveBackward={onMoveBackward}
          onMoveForward={onMoveForward}
          onZoom={onZoom}
        />
        <ToolbarButton icon="play" variant="primary" tooltip="Run query" aria-label="apply filters" onClick={onApply}>
          Run query
        </ToolbarButton>
      </Stack>

      {chips.length > 0 && (
        <Stack direction="row" gap={0.5} alignItems="center" wrap="wrap">
          {chips.map((chip) => (
            <Tag key={chip.id} name={chip.label} />
          ))}
        </Stack>
      )}

      <Stack direction="row" gap={0.5} alignItems="center" wrap="wrap">
        <Text color="secondary" italic>
          Keys:
        </Text>
        {loadingTags && <Spinner inline size="sm" />}
        {!loadingTags &&
          suggestedTags.map((tag) => (
            <FilterPill
              key={tag.key}
              label={tag.key}
              selected={false}
              onClick={() => onFilterChange(appendTagSuggestion(filter, tag.key))}
            />
          ))}
      </Stack>

      {activeTag.length > 0 && (
        <Stack direction="row" gap={0.5} alignItems="center" wrap="wrap">
          <Text color="secondary" italic>
            Values for {activeTag}:
          </Text>
          {loadingValues && <Spinner inline size="sm" />}
          {!loadingValues &&
            suggestedValues.map((value) => (
              <FilterPill
                key={value}
                label={value}
                selected={false}
                onClick={() => onFilterChange(appendValueSuggestion(filter, value))}
              />
            ))}
        </Stack>
      )}
    </Stack>
  );
}
