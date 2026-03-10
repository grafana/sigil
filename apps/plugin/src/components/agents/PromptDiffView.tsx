import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Text, useStyles2 } from '@grafana/ui';

export type PromptDiffViewProps = {
  oldPrompt: string;
  newPrompt: string;
  oldLabel?: string;
  newLabel?: string;
};

type DiffLine = {
  type: 'equal' | 'add' | 'remove';
  text: string;
};

function computeLCS(a: string[], b: string[]): boolean[][] {
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const inLCSa: boolean[] = Array(m).fill(false);
  const inLCSb: boolean[] = Array(n).fill(false);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      inLCSa[i - 1] = true;
      inLCSb[j - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return [inLCSa as unknown as boolean[], inLCSb as unknown as boolean[]];
}

export function computeDiffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const [inLCSold, inLCSnew] = computeLCS(oldLines, newLines);

  const result: DiffLine[] = [];
  let oi = 0;
  let ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && !inLCSold[oi]) {
      result.push({ type: 'remove', text: oldLines[oi] });
      oi++;
    } else if (ni < newLines.length && !inLCSnew[ni]) {
      result.push({ type: 'add', text: newLines[ni] });
      ni++;
    } else {
      if (oi < oldLines.length) {
        result.push({ type: 'equal', text: oldLines[oi] });
      }
      oi++;
      ni++;
    }
  }

  return result;
}

export function PromptDiffView({ oldPrompt, newPrompt, oldLabel, newLabel }: PromptDiffViewProps) {
  const styles = useStyles2(getStyles);

  const diffLines = useMemo(() => computeDiffLines(oldPrompt, newPrompt), [oldPrompt, newPrompt]);

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const line of diffLines) {
      if (line.type === 'add') {
        added++;
      }
      if (line.type === 'remove') {
        removed++;
      }
    }
    return { added, removed };
  }, [diffLines]);

  return (
    <div className={styles.container} data-testid="prompt-diff-view">
      <div className={styles.header}>
        <Text variant="bodySmall" color="secondary">
          Comparing <strong>{oldLabel ?? 'previous version'}</strong>
          {' → '}
          <strong>{newLabel ?? 'current version'}</strong>
        </Text>
        <div className={styles.stats}>
          {stats.added > 0 && <span className={styles.statAdded}>+{stats.added}</span>}
          {stats.removed > 0 && <span className={styles.statRemoved}>-{stats.removed}</span>}
          {stats.added === 0 && stats.removed === 0 && (
            <Text variant="bodySmall" color="secondary">
              No changes
            </Text>
          )}
        </div>
      </div>
      <pre className={styles.diffPre}>
        {diffLines.map((line, idx) => {
          let lineClass = styles.lineEqual;
          let gutter = ' ';
          if (line.type === 'add') {
            lineClass = styles.lineAdd;
            gutter = '+';
          } else if (line.type === 'remove') {
            lineClass = styles.lineRemove;
            gutter = '-';
          }
          return (
            <div key={idx} className={lineClass} data-testid={`diff-line-${line.type}`}>
              <span className={styles.gutter}>{gutter}</span>
              <span className={styles.lineText}>{line.text || '\n'}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.5),
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing(1),
      padding: theme.spacing(0.5, 0),
    }),
    stats: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      fontVariantNumeric: 'tabular-nums',
    }),
    statAdded: css({
      color: theme.colors.success.text,
    }),
    statRemoved: css({
      color: theme.colors.error.text,
    }),
    diffPre: css({
      margin: 0,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.canvas,
      padding: 0,
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.size.sm,
      lineHeight: 1.6,
      color: theme.colors.text.primary,
    }),
    lineEqual: css({
      display: 'flex',
      minHeight: '1.6em',
    }),
    lineAdd: css({
      display: 'flex',
      minHeight: '1.6em',
      backgroundColor: `${theme.colors.success.main}1A`,
      borderLeft: `3px solid ${theme.colors.success.main}`,
    }),
    lineRemove: css({
      display: 'flex',
      minHeight: '1.6em',
      backgroundColor: `${theme.colors.error.main}1A`,
      borderLeft: `3px solid ${theme.colors.error.main}`,
    }),
    gutter: css({
      display: 'inline-block',
      width: 24,
      minWidth: 24,
      textAlign: 'center',
      color: theme.colors.text.secondary,
      userSelect: 'none',
      flexShrink: 0,
    }),
    lineText: css({
      flex: 1,
      minWidth: 0,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      paddingRight: theme.spacing(1),
    }),
  };
}
