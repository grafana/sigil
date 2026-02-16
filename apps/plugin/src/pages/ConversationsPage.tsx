import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Spinner, Stack, Text } from '@grafana/ui';
import { defaultConversationsDataSource, type ConversationsDataSource } from '../conversation/api';
import type {
  ConversationDetail,
  ConversationSearchRequest,
  ConversationSearchResult,
  GenerationDetail,
  SearchTag,
} from '../conversation/types';
import FilterBar from '../components/FilterBar';

type ConversationsPageProps = {
  dataSource?: ConversationsDataSource;
};

function defaultRangeFrom(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function defaultRangeTo(): string {
  return new Date().toISOString();
}

export default function ConversationsPage(props: ConversationsPageProps) {
  const dataSource = props.dataSource ?? defaultConversationsDataSource;

  const [filterText, setFilterText] = useState<string>('');
  const [rangeFrom, setRangeFrom] = useState<string>(defaultRangeFrom());
  const [rangeTo, setRangeTo] = useState<string>(defaultRangeTo());

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

  const selectedConversation = useMemo(() => {
    if (selectedConversationID.length === 0) {
      return null;
    }
    return searchResults.find((item) => item.conversation_id === selectedConversationID) ?? null;
  }, [searchResults, selectedConversationID]);

  const runSearch = async (cursor?: string, append?: boolean): Promise<void> => {
    searchRequestVersion.current += 1;
    const requestVersion = searchRequestVersion.current;

    const payload: ConversationSearchRequest = {
      filters: filterText,
      select: [],
      time_range: {
        from: rangeFrom,
        to: rangeTo,
      },
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

  const resultRows = searchResults.map((conversation) => {
    const selected = conversation.conversation_id === selectedConversationID;
    return (
      <tr
        key={conversation.conversation_id}
        style={{ background: selected ? 'rgba(34, 102, 255, 0.12)' : 'transparent' }}
      >
        <td>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSelectedConversationID(conversation.conversation_id)}
            aria-label={`select conversation ${conversation.conversation_id}`}
          >
            {conversation.conversation_id}
          </Button>
        </td>
        <td>{conversation.generation_count}</td>
        <td>{conversation.models.join(', ') || '-'}</td>
        <td>{conversation.agents.join(', ') || '-'}</td>
        <td>{conversation.error_count}</td>
        <td>{new Date(conversation.last_generation_at).toLocaleString()}</td>
      </tr>
    );
  });

  return (
    <Stack direction="column" gap={2}>
      <h2>Conversations</h2>

      <FilterBar
        filter={filterText}
        from={rangeFrom}
        to={rangeTo}
        tags={tags}
        tagValues={tagValues}
        loadingTags={loadingTags}
        loadingValues={loadingTagValues}
        onFilterChange={setFilterText}
        onFromChange={setRangeFrom}
        onToChange={setRangeTo}
        onApply={() => void runSearch('', false)}
        onRequestTagValues={requestTagValues}
      />

      {errorMessage.length > 0 && (
        <Alert severity="error" title="Conversation query failed">
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      <Stack direction="row" gap={2}>
        <Stack direction="column" gap={1}>
          <Text weight="bold">Conversation search results</Text>
          {loadingSearch && <Spinner aria-label="loading conversations" />}
          {!loadingSearch && searchResults.length === 0 && (
            <Text>No conversations found. Apply a filter to start.</Text>
          )}
          {!loadingSearch && searchResults.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Conversation</th>
                  <th>Generations</th>
                  <th>Models</th>
                  <th>Agents</th>
                  <th>Errors</th>
                  <th>Last generation</th>
                </tr>
              </thead>
              <tbody>{resultRows}</tbody>
            </table>
          )}
          {hasMore && nextCursor.length > 0 && (
            <Button
              aria-label="load more conversations"
              onClick={() => void runSearch(nextCursor, true)}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </Stack>

        <Stack direction="column" gap={1}>
          <Text weight="bold">Conversation detail</Text>
          {selectedConversation && (
            <Text color="secondary">
              {selectedConversation.conversation_id} • {selectedConversation.generation_count} generations
            </Text>
          )}
          {loadingConversationDetail && <Spinner aria-label="loading conversation detail" />}
          {!loadingConversationDetail && conversationDetail && (
            <Stack direction="column" gap={1}>
              <Text>
                {conversationDetail.generations.length} generation payloads • {conversationDetail.annotations.length}{' '}
                annotations
              </Text>
              {conversationDetail.generations.map((generation) => {
                const traceID = typeof generation.trace_id === 'string' ? generation.trace_id : '';
                return (
                  <Stack key={generation.generation_id} direction="row" gap={1}>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`select generation ${generation.generation_id}`}
                      onClick={() => setSelectedGenerationID(generation.generation_id)}
                    >
                      {generation.generation_id}
                    </Button>
                    <Text color="secondary">
                      {generation.created_at ? new Date(generation.created_at).toLocaleString() : '-'}
                    </Text>
                    {traceID.length > 0 && (
                      <a
                        href={`/api/plugins/grafana-sigil-app/resources/query/proxy/tempo/api/v2/traces/${encodeURIComponent(traceID)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Trace
                      </a>
                    )}
                  </Stack>
                );
              })}
            </Stack>
          )}
        </Stack>

        <Stack direction="column" gap={1}>
          <Text weight="bold">Generation detail</Text>
          {selectedGenerationID.length === 0 && <Text>Select a generation to inspect payload.</Text>}
          {loadingGenerationDetail && <Spinner aria-label="loading generation detail" />}
          {!loadingGenerationDetail && generationDetail && (
            <pre style={{ maxWidth: '520px', whiteSpace: 'pre-wrap' }}>{JSON.stringify(generationDetail, null, 2)}</pre>
          )}
        </Stack>
      </Stack>
    </Stack>
  );
}
