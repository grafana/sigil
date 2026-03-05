import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, IconButton, useStyles2 } from '@grafana/ui';
import { useInlineAssistant } from '@grafana/assistant';
import { Loader } from '../Loader';
import { formatInlineMarkup } from './formatInlineMarkup';

export type PageInsightBarProps = {
  prompt: string;
  origin: string;
  dataContext: string | null;
  systemPrompt?: string;
};

const DEFAULT_SYSTEM_PROMPT =
  'You are a concise observability analyst. Return exactly 2-3 high-confidence findings. Each finding is a single short sentence on its own line prefixed with "- ". Bold key numbers/metrics with **bold**. No headers, no paragraphs, no extra text. Keep each bullet under 20 words. Focus on anomalies, changes, or notable patterns only.';

const STORAGE_KEY = 'sigil.insightBar.collapsed';

function readCollapsed(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // storage unavailable
  }
}

export function PageInsightBar({
  prompt,
  origin,
  dataContext,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
}: PageInsightBarProps) {
  const styles = useStyles2(getStyles);
  const gen = useInlineAssistant();
  const [text, setText] = useState('');
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const hasAutoRun = useRef(false);
  const lastDataContextRef = useRef<string | null>(null);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(next);
      return next;
    });
  }, []);

  const latestRef = useRef({ prompt, origin, systemPrompt, dataContext, gen });
  useEffect(() => {
    latestRef.current = { prompt, origin, systemPrompt, dataContext, gen };
  });

  const runGenerate = useCallback((ctx: string) => {
    const { prompt: p, origin: o, systemPrompt: sp, gen: g } = latestRef.current;
    const fullPrompt = `${p}\n\nData context:\n${ctx}`;
    g.generate({
      prompt: fullPrompt,
      origin: o,
      systemPrompt: sp,
      onComplete: (result: string) => setText(result),
      onError: (err: Error) => console.error('Insight generation failed:', err),
    });
  }, []);

  useEffect(() => {
    if (collapsed) {
      return;
    }
    if (!dataContext) {
      lastDataContextRef.current = null;
      return;
    }
    if (gen.isGenerating) {
      return;
    }
    if (lastDataContextRef.current === dataContext) {
      return;
    }
    lastDataContextRef.current = dataContext;
    if (!hasAutoRun.current) {
      hasAutoRun.current = true;
      runGenerate(dataContext);
    }
  }, [collapsed, dataContext, gen.isGenerating, runGenerate]);

  const doRegenerate = useCallback(() => {
    const { dataContext: ctx, gen: g } = latestRef.current;
    if (ctx && !g.isGenerating) {
      setText('');
      runGenerate(ctx);
    }
  }, [runGenerate]);

  const displayText = gen.isGenerating ? gen.content : text;
  const initialWaiting = !dataContext && !text && !gen.isGenerating;
  const hasResult = Boolean(text) || gen.isGenerating;

  const bullets = useMemo(() => {
    if (!displayText) {
      return [];
    }
    return displayText
      .split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter((l) => l.length > 0);
  }, [displayText]);

  const firstBullet = bullets.length > 0 ? bullets[0] : null;

  return (
    <div className={collapsed ? styles.barCollapsed : styles.bar} role="complementary" aria-label="Page insight">
      <div className={styles.header}>
        <button
          type="button"
          className={styles.headerToggle}
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand insights' : 'Collapse insights'}
        >
          <Icon name="ai" size="md" className={styles.aiIcon} />
          <span className={styles.headerTitle}>Insight</span>
          {collapsed && firstBullet && (
            <span className={styles.collapsedPreview}>{formatInlineMarkup(firstBullet)}</span>
          )}
          <Icon name={collapsed ? 'angle-down' : 'angle-up'} size="md" className={styles.chevron} />
        </button>

        <div className={styles.actions}>
          {gen.isGenerating && <Loader showText={false} />}
          {!gen.isGenerating && hasResult && (
            <IconButton
              name="sync"
              aria-label="Regenerate insight"
              tooltip="Regenerate"
              size="sm"
              onClick={doRegenerate}
            />
          )}
        </div>
      </div>

      {!collapsed && (
        <div className={styles.body}>
          {initialWaiting ? (
            <span className={styles.placeholder}>Waiting for data...</span>
          ) : gen.isGenerating && bullets.length === 0 ? (
            <span className={styles.placeholder}>Generating insight...</span>
          ) : bullets.length > 0 ? (
            <ul className={styles.bulletList}>
              {bullets.map((bullet, i) => (
                <li key={i} className={styles.bulletItem}>
                  <span className={styles.bulletArrow}>→</span>
                  <span className={styles.bulletText}>{formatInlineMarkup(bullet)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className={styles.placeholder}>No notable insights.</span>
          )}
        </div>
      )}
    </div>
  );
}

const EXPANDED_HEIGHT = 132;
const COLLAPSED_HEIGHT = 40;

function getStyles(theme: GrafanaTheme2) {
  const barBase = {
    width: '100%',
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.primary.main}2d`,
    boxShadow: `0 0 0 1px ${theme.colors.primary.main}14, 0 0 10px ${theme.colors.primary.main}1f`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden' as const,
  };

  return {
    bar: css({
      ...barBase,
      height: EXPANDED_HEIGHT,
    }),
    barCollapsed: css({
      ...barBase,
      height: COLLAPSED_HEIGHT,
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: theme.spacing(1, 1.5),
      height: COLLAPSED_HEIGHT,
    }),
    headerToggle: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      padding: 0,
      minWidth: 0,
      flex: 1,
      color: theme.colors.text.primary,
    }),
    aiIcon: css({
      flexShrink: 0,
      color: theme.colors.primary.text,
    }),
    headerTitle: css({
      fontSize: theme.typography.body.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      flexShrink: 0,
    }),
    collapsedPreview: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      minWidth: 0,
      paddingLeft: theme.spacing(1),
      '& strong': {
        fontWeight: theme.typography.fontWeightBold,
        color: theme.colors.text.primary,
      },
      '& code': {
        fontSize: '0.85em',
        padding: '1px 4px',
        borderRadius: theme.shape.radius.default,
        background: theme.colors.background.primary,
        fontFamily: theme.typography.fontFamilyMonospace,
      },
    }),
    chevron: css({
      flexShrink: 0,
      color: theme.colors.text.secondary,
    }),
    actions: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      flexShrink: 0,
    }),
    body: css({
      padding: theme.spacing(0, 1.5, 1.5),
      height: EXPANDED_HEIGHT - COLLAPSED_HEIGHT,
      overflow: 'hidden',
    }),
    placeholder: css({
      color: theme.colors.text.secondary,
      fontStyle: 'italic',
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    bulletList: css({
      margin: 0,
      padding: 0,
      listStyle: 'none',
      display: 'flex',
      gap: theme.spacing(1),
      height: '100%',
    }),
    bulletItem: css({
      display: 'flex',
      alignItems: 'flex-start',
      gap: theme.spacing(1),
      padding: theme.spacing(1.25),
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      overflow: 'hidden',
      flex: '1 1 0%',
      minWidth: 0,
    }),
    bulletArrow: css({
      flexShrink: 0,
      color: theme.colors.text.disabled,
      fontWeight: theme.typography.fontWeightBold,
      lineHeight: 1.6,
    }),
    bulletText: css({
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.6,
      color: theme.colors.text.secondary,
      display: '-webkit-box',
      WebkitLineClamp: 3,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
      '& strong': {
        fontWeight: theme.typography.fontWeightBold,
        color: theme.colors.text.primary,
      },
      '& code': {
        fontSize: '0.85em',
        padding: '1px 4px',
        borderRadius: theme.shape.radius.default,
        background: theme.colors.background.canvas,
        fontFamily: theme.typography.fontFamilyMonospace,
      },
    }),
  };
}
