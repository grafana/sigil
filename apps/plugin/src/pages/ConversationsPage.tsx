import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { css } from '@emotion/css';
import { dateTimeParse, type GrafanaTheme2, type TimeRange } from '@grafana/data';
import { Alert, Text, useStyles2 } from '@grafana/ui';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type {
  ConversationDetail,
  ConversationSearchRequest,
  ConversationSearchResponse,
  ConversationSearchResult,
  GenerationDetail,
  SearchTag,
} from '../conversation/types';
import FilterBar from '../components/FilterBar';
import ConversationListPanel from '../components/conversations/ConversationListPanel';
import GenerationViewerPanel from '../components/generation/GenerationViewerPanel';
import { isAbortError } from '../utils/http';

export type ConversationsPageProps = {
  dataSource?: ConversationsDataSource;
};

const getStyles = (theme: GrafanaTheme2) => ({
  layout: css({
    display: 'grid',
    gridTemplateColumns: 'minmax(380px, 1fr) 2fr',
    gap: theme.spacing(2),
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  }),
  leftPanel: css({
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
  }),
  rightPanel: css({
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    borderLeft: `1px solid ${theme.colors.border.weak}`,
    paddingLeft: theme.spacing(2),
  }),
  pageContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    gap: theme.spacing(2),
  }),
});

const DEFAULT_FROM = 'now-24h';
const DEFAULT_TO = 'now';

function parseTimeRange(params: URLSearchParams): TimeRange {
  const rawFrom = params.get('from') || DEFAULT_FROM;
  const rawTo = params.get('to') || DEFAULT_TO;
  return {
    from: dateTimeParse(rawFrom),
    to: dateTimeParse(rawTo),
    raw: { from: rawFrom, to: rawTo },
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string, defaultValue: string): void {
  if (value === defaultValue) {
    params.delete(key);
  } else {
    params.set(key, value);
  }
}

export default function ConversationsPage(props: ConversationsPageProps) {
  const dataSource = props.dataSource ?? defaultConversationsDataSource;
  const styles = useStyles2(getStyles);

  const [searchParams, setSearchParams] = useSearchParams();
  const filterText = searchParams.get('filter') ?? '';
  const timeRange = useMemo(() => parseTimeRange(searchParams), [searchParams]);

  const setFilterText = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === '') {
            next.delete('filter');
          } else {
            next.set('filter', value);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setTimeRange = useCallback(
    (tr: TimeRange) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          setOrDelete(next, 'from', String(tr.raw.from), DEFAULT_FROM);
          setOrDelete(next, 'to', String(tr.raw.to), DEFAULT_TO);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const [tags, setTags] = useState<SearchTag[]>([]);
  const [tagValues, setTagValues] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState<boolean>(false);
  const [loadingTagValues, setLoadingTagValues] = useState<boolean>(false);

  const [searchResults, setSearchResults] = useState<ConversationSearchResult[]>([]);
  const [loadingSearch, setLoadingSearch] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<string>('');
  const [hasMore, setHasMore] = useState<boolean>(false);

  const [selectedConversationID, setSelectedConversationID] = useState<string>('');
  const [conversationDetail, setConversationDetail] = useState<ConversationDetail | null>(null);
  const [loadingConversationDetail, setLoadingConversationDetail] = useState<boolean>(false);

  const [selectedGenerationID, setSelectedGenerationID] = useState<string>('');
  const generationDetail = useMemo<GenerationDetail | null>(() => {
    if (!conversationDetail || selectedGenerationID.length === 0) {
      return null;
    }
    return (
      conversationDetail.generations?.find((generation) => generation.generation_id === selectedGenerationID) ?? null
    );
  }, [conversationDetail, selectedGenerationID]);

  const [errorMessage, setErrorMessage] = useState<string>('');

  const searchRequestVersion = useRef<number>(0);
  const searchAbortController = useRef<AbortController | null>(null);
  const conversationDetailRequestVersion = useRef<number>(0);
  const tagsRequestVersion = useRef<number>(0);
  const tagValuesRequestVersion = useRef<number>(0);
  const inFlightTagValuesKey = useRef<string>('');
  const tagValuesCache = useRef<Map<string, string[]>>(new Map());

  const runSearch = async (cursor?: string, append?: boolean): Promise<void> => {
    searchRequestVersion.current += 1;
    const requestVersion = searchRequestVersion.current;
    searchAbortController.current?.abort();
    const abortController = new AbortController();
    searchAbortController.current = abortController;

    const payload: ConversationSearchRequest = {
      filters: filterText,
      select: [],
      time_range: { from: timeRange.from.toISOString(), to: timeRange.to.toISOString() },
      page_size: 20,
      cursor,
    };
    const previousResults = append ? searchResults : [];
    const previousCursor = append ? nextCursor : '';
    const previousHasMore = append ? hasMore : false;

    if (append) {
      setLoadingMore(true);
    } else {
      setLoadingSearch(true);
      setErrorMessage('');
      setSearchResults([]);
      setNextCursor('');
      setHasMore(false);
      setSelectedConversationID('');
    }

    try {
      let selectedFirstConversation = false;
      const handleBatch = (conversations: ConversationSearchResult[]) => {
        if (searchRequestVersion.current !== requestVersion) {
          return;
        }
        if (!append && conversations.length > 0) {
          setLoadingSearch(false);
        }
        setSearchResults((current) => [...current, ...(conversations ?? [])]);
        if (!append && !selectedFirstConversation && conversations.length > 0) {
          selectedFirstConversation = true;
          setSelectedConversationID(conversations[0].conversation_id);
        }
      };

      const handleComplete = (response: Pick<ConversationSearchResponse, 'next_cursor' | 'has_more'>) => {
        if (searchRequestVersion.current !== requestVersion) {
          return;
        }
        setNextCursor(response.next_cursor ?? '');
        setHasMore(Boolean(response.has_more));
      };

      if (dataSource.streamSearchConversations) {
        await dataSource.streamSearchConversations(payload, {
          signal: abortController.signal,
          onResults: handleBatch,
          onComplete: handleComplete,
        });
      } else {
        const response = await dataSource.searchConversations(payload);
        handleBatch(response.conversations ?? []);
        handleComplete(response);
      }
      if (searchRequestVersion.current !== requestVersion) {
        return;
      }
      if (!append && !selectedFirstConversation) {
        setSelectedConversationID('');
      }
    } catch (error) {
      if (searchRequestVersion.current !== requestVersion || isAbortError(error)) {
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : 'failed to search conversations');
      if (append) {
        setSearchResults(previousResults);
        setNextCursor(previousCursor);
        setHasMore(previousHasMore);
      } else {
        setNextCursor('');
        setHasMore(false);
      }
    } finally {
      if (searchRequestVersion.current !== requestVersion) {
        return;
      }
      if (searchAbortController.current === abortController) {
        searchAbortController.current = null;
      }
      setLoadingSearch(false);
      setLoadingMore(false);
    }
  };

  const rangeFrom = timeRange.from.toISOString();
  const rangeTo = timeRange.to.toISOString();

  useEffect(() => {
    return () => {
      searchAbortController.current?.abort();
    };
  }, []);

  useEffect(() => {
    tagsRequestVersion.current += 1;
    const requestVersion = tagsRequestVersion.current;

    setLoadingTags(true);
    setErrorMessage('');

    void dataSource
      .getSearchTags(rangeFrom, rangeTo)
      .then((items) => {
        if (tagsRequestVersion.current !== requestVersion) {
          return;
        }
        setTags(items);
      })
      .catch((error) => {
        if (tagsRequestVersion.current !== requestVersion) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load search tags');
        setTags([]);
      })
      .finally(() => {
        if (tagsRequestVersion.current !== requestVersion) {
          return;
        }
        setLoadingTags(false);
      });
  }, [dataSource, rangeFrom, rangeTo]);

  useEffect(() => {
    conversationDetailRequestVersion.current += 1;
    const requestVersion = conversationDetailRequestVersion.current;

    if (selectedConversationID.length === 0) {
      setConversationDetail(null);
      setSelectedGenerationID('');
      setLoadingConversationDetail(false);
      return;
    }

    setLoadingConversationDetail(true);
    setErrorMessage('');
    void dataSource
      .getConversationDetail(selectedConversationID)
      .then((detail) => {
        if (conversationDetailRequestVersion.current !== requestVersion) {
          return;
        }
        setConversationDetail(detail);
        setSelectedGenerationID(detail.generations?.[0]?.generation_id ?? '');
      })
      .catch((error) => {
        if (conversationDetailRequestVersion.current !== requestVersion) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load conversation detail');
        setConversationDetail(null);
        setSelectedGenerationID('');
      })
      .finally(() => {
        if (conversationDetailRequestVersion.current !== requestVersion) {
          return;
        }
        setLoadingConversationDetail(false);
      });
  }, [dataSource, selectedConversationID]);

  const requestTagValues = useCallback(
    (tag: string): void => {
      const trimmedTag = tag.trim();
      if (trimmedTag.length === 0) {
        return;
      }

      const requestKey = `${trimmedTag}|${rangeFrom}|${rangeTo}`;
      const cachedValues = tagValuesCache.current.get(requestKey);
      if (cachedValues) {
        setTagValues(cachedValues);
        setLoadingTagValues(false);
        return;
      }
      if (inFlightTagValuesKey.current === requestKey) {
        return;
      }

      tagValuesRequestVersion.current += 1;
      const requestVersion = tagValuesRequestVersion.current;
      inFlightTagValuesKey.current = requestKey;
      setLoadingTagValues(true);
      void dataSource
        .getSearchTagValues(trimmedTag, rangeFrom, rangeTo)
        .then((values) => {
          tagValuesCache.current.set(requestKey, values);
          if (tagValuesRequestVersion.current !== requestVersion) {
            return;
          }
          setTagValues(values);
        })
        .catch(() => {
          if (tagValuesRequestVersion.current !== requestVersion) {
            return;
          }
          setTagValues([]);
        })
        .finally(() => {
          if (inFlightTagValuesKey.current === requestKey) {
            inFlightTagValuesKey.current = '';
          }
          if (tagValuesRequestVersion.current !== requestVersion) {
            return;
          }
          setLoadingTagValues(false);
        });
    },
    [dataSource, rangeFrom, rangeTo]
  );

  return (
    <div className={styles.pageContainer}>
      <FilterBar
        filter={filterText}
        timeRange={timeRange}
        tags={tags}
        tagValues={tagValues}
        loadingTags={loadingTags}
        loadingValues={loadingTagValues}
        onFilterChange={setFilterText}
        onTimeRangeChange={setTimeRange}
        onApply={() => void runSearch('', false)}
        onRequestTagValues={requestTagValues}
      />

      {errorMessage.length > 0 && (
        <Alert severity="error" title="Conversation query failed">
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <div className={styles.layout}>
        <div className={styles.leftPanel}>
          <ConversationListPanel
            conversations={searchResults}
            selectedConversationId={selectedConversationID}
            loading={loadingSearch}
            hasMore={hasMore && nextCursor.length > 0}
            loadingMore={loadingMore}
            onSelectConversation={setSelectedConversationID}
            onLoadMore={() => void runSearch(nextCursor, true)}
          />
        </div>
        <div className={styles.rightPanel}>
          <GenerationViewerPanel
            conversationDetail={conversationDetail}
            generationDetail={generationDetail}
            loading={loadingConversationDetail}
            onSelectGeneration={setSelectedGenerationID}
          />
        </div>
      </div>
    </div>
  );
}
