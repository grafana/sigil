import React, { useCallback, useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, type GrafanaTheme2, makeTimeRange, type TimeRange } from '@grafana/data';
import { Alert, Text, useStyles2 } from '@grafana/ui';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type {
  ConversationDetail,
  ConversationSearchRequest,
  ConversationSearchResult,
  GenerationDetail,
  SearchTag,
} from '../conversation/types';
import FilterBar from '../components/FilterBar';
import ConversationListPanel from '../components/conversations/ConversationListPanel';
import GenerationViewerPanel from '../components/generation/GenerationViewerPanel';

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

export default function ConversationsPage(props: ConversationsPageProps) {
  const dataSource = props.dataSource ?? defaultConversationsDataSource;
  const styles = useStyles2(getStyles);

  const [filterText, setFilterText] = useState<string>('');
  const [timeRange, setTimeRange] = useState<TimeRange>(() => {
    const now = dateTime();
    return makeTimeRange(dateTime(now).subtract(24, 'hours'), now);
  });

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
  const [generationDetail, setGenerationDetail] = useState<GenerationDetail | null>(null);
  const [loadingGenerationDetail, setLoadingGenerationDetail] = useState<boolean>(false);

  const [errorMessage, setErrorMessage] = useState<string>('');

  const searchRequestVersion = useRef<number>(0);
  const conversationDetailRequestVersion = useRef<number>(0);
  const generationDetailRequestVersion = useRef<number>(0);
  const tagsRequestVersion = useRef<number>(0);
  const tagValuesRequestVersion = useRef<number>(0);
  const inFlightTagValuesKey = useRef<string>('');
  const tagValuesCache = useRef<Map<string, string[]>>(new Map());

  const runSearch = async (cursor?: string, append?: boolean): Promise<void> => {
    searchRequestVersion.current += 1;
    const requestVersion = searchRequestVersion.current;

    const payload: ConversationSearchRequest = {
      filters: filterText,
      select: [],
      time_range: { from: timeRange.from.toISOString(), to: timeRange.to.toISOString() },
      page_size: 20,
      cursor,
    };

    if (append) {
      setLoadingMore(true);
    } else {
      setLoadingSearch(true);
      setErrorMessage('');
    }

    try {
      const response = await dataSource.searchConversations(payload);
      if (searchRequestVersion.current !== requestVersion) {
        return;
      }
      setSearchResults((current) =>
        append ? [...current, ...(response.conversations ?? [])] : (response.conversations ?? [])
      );
      setNextCursor(response.next_cursor ?? '');
      setHasMore(Boolean(response.has_more));

      if (!append) {
        const firstConversationID = response.conversations?.[0]?.conversation_id ?? '';
        setSelectedConversationID(firstConversationID);
      }
    } catch (error) {
      if (searchRequestVersion.current !== requestVersion) {
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : 'failed to search conversations');
      if (!append) {
        setSearchResults([]);
        setNextCursor('');
        setHasMore(false);
        setSelectedConversationID('');
      }
    } finally {
      if (searchRequestVersion.current !== requestVersion) {
        return;
      }
      setLoadingSearch(false);
      setLoadingMore(false);
    }
  };

  const rangeFrom = timeRange.from.toISOString();
  const rangeTo = timeRange.to.toISOString();

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
      setGenerationDetail(null);
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
        setGenerationDetail(null);
      })
      .finally(() => {
        if (conversationDetailRequestVersion.current !== requestVersion) {
          return;
        }
        setLoadingConversationDetail(false);
      });
  }, [dataSource, selectedConversationID]);

  useEffect(() => {
    generationDetailRequestVersion.current += 1;
    const requestVersion = generationDetailRequestVersion.current;

    if (selectedGenerationID.length === 0) {
      setGenerationDetail(null);
      setLoadingGenerationDetail(false);
      return;
    }

    setLoadingGenerationDetail(true);
    setErrorMessage('');
    void dataSource
      .getGeneration(selectedGenerationID)
      .then((detail) => {
        if (generationDetailRequestVersion.current !== requestVersion) {
          return;
        }
        setGenerationDetail(detail);
      })
      .catch((error) => {
        if (generationDetailRequestVersion.current !== requestVersion) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'failed to load generation detail');
        setGenerationDetail(null);
      })
      .finally(() => {
        if (generationDetailRequestVersion.current !== requestVersion) {
          return;
        }
        setLoadingGenerationDetail(false);
      });
  }, [dataSource, selectedGenerationID]);

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
      <Text element="h2">Conversations</Text>

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
            loading={loadingConversationDetail || loadingGenerationDetail}
            onSelectGeneration={setSelectedGenerationID}
          />
        </div>
      </div>
    </div>
  );
}
