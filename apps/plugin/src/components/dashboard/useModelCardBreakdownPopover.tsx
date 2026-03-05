import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { BreakdownDimension, PrometheusQueryResponse } from '../../dashboard/types';
import type { ModelCard } from '../../modelcard/types';
import { defaultModelCardClient, type ModelCardClient } from '../../modelcard/api';
import { resolveModelCardsFromNames, inferProviderFromModelName } from '../../modelcard/resolve';
import ModelCardPopover from '../conversations/ModelCardPopover';

type ModelCardBreakdownPopoverResult = {
  onModelClick: ((name: string, event: React.MouseEvent<HTMLButtonElement>) => void) | undefined;
  modelPopoverElement: React.ReactNode;
};

/**
 * Resolves model cards from breakdown data and manages model card popover state.
 * When breakdownBy is 'model', extracts model names from the Prometheus response,
 * resolves them to full ModelCard objects, and returns a click handler + popover element.
 */
export function useModelCardBreakdownPopover(
  breakdownBy: BreakdownDimension,
  breakdownData: PrometheusQueryResponse | null | undefined,
  client: ModelCardClient = defaultModelCardClient
): ModelCardBreakdownPopoverResult {
  const [cards, setCards] = useState<Map<string, ModelCard>>(new Map());
  const [openModel, setOpenModel] = useState<{ name: string; anchorRect: DOMRect } | null>(null);

  const modelNames = useMemo(() => {
    if (breakdownBy !== 'model' || !breakdownData || breakdownData.data.resultType !== 'vector') {
      return [];
    }
    const names = new Set<string>();
    for (const result of breakdownData.data.result) {
      const model = (result as { metric: Record<string, string> }).metric.gen_ai_request_model;
      if (model) {
        names.add(model);
      }
    }
    return Array.from(names);
  }, [breakdownBy, breakdownData]);

  useEffect(() => {
    if (modelNames.length === 0) {
      return;
    }

    let cancelled = false;

    resolveModelCardsFromNames(modelNames, client)
      .then((resolved) => {
        if (!cancelled) {
          setCards(resolved);
        }
      })
      .catch(() => {
        // Silently ignore resolution failures; cards remain stale or empty.
      });

    return () => {
      cancelled = true;
    };
  }, [modelNames, client]);

  const onModelClick = useCallback(
    (name: string, event: React.MouseEvent<HTMLButtonElement>) => {
      const provider = inferProviderFromModelName(name);
      const key = `${provider}::${name}`;
      const card = cards.get(key);
      if (!card) {
        return;
      }
      setOpenModel({ name, anchorRect: event.currentTarget.getBoundingClientRect() });
    },
    [cards]
  );

  const handleClose = useCallback(() => setOpenModel(null), []);

  if (breakdownBy !== 'model') {
    return { onModelClick: undefined, modelPopoverElement: null };
  }

  const openCard = openModel ? cards.get(`${inferProviderFromModelName(openModel.name)}::${openModel.name}`) : null;

  return {
    onModelClick,
    modelPopoverElement:
      openModel && openCard ? (
        <ModelCardPopover card={openCard} anchorRect={openModel.anchorRect} onClose={handleClose} />
      ) : null,
  };
}
