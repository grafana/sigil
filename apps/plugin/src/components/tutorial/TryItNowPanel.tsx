import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Button, HorizontalGroup, IconButton, Stack, Text, useStyles2 } from '@grafana/ui';
import {
  getInstrumentationPrompt,
  getInstrumentationPromptFilename,
  type InstrumentationPromptIde,
} from '../../content/cursorInstrumentationPrompt';
import { ideTabs, buildCursorPromptDeeplink, downloadTextFile, renderIdeActionLogo } from '../../ide/ideUtils';

export function TryItNowPanel() {
  const styles = useStyles2(getStyles);
  const [selectedIde, setSelectedIde] = useState<InstrumentationPromptIde>('cursor');
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);

  const selectedIdeConfig = useMemo(() => ideTabs.find((ide) => ide.key === selectedIde) ?? ideTabs[0], [selectedIde]);
  const selectedPrompt = useMemo(() => getInstrumentationPrompt(selectedIde), [selectedIde]);
  const cursorDeeplink = useMemo(() => buildCursorPromptDeeplink(selectedPrompt), [selectedPrompt]);

  return (
    <>
      <section className={styles.panel}>
        <h3 className={styles.heading}>Try it now</h3>
        <div className={styles.ideTabs}>
          {ideTabs.map((ide) => (
            <button
              key={ide.key}
              type="button"
              className={styles.ideTabButton}
              onClick={() => {
                setSelectedIde(ide.key);
                setIsAgentModalOpen(true);
              }}
              aria-label={`Open ${ide.label} instrumentation details`}
            >
              <span className={styles.ideTabLogo}>{ide.logo}</span>
              <span>{ide.label}</span>
            </button>
          ))}
        </div>
      </section>

      {isAgentModalOpen && (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => setIsAgentModalOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedIdeConfig.label} instrumentation`}
            className={styles.modalCard}
            onClick={(event) => event.stopPropagation()}
          >
            <Stack direction="column" gap={2}>
              <HorizontalGroup justify="space-between">
                <Text element="h4">{selectedIdeConfig.label}</Text>
                <Button variant="secondary" size="sm" onClick={() => setIsAgentModalOpen(false)}>
                  Close
                </Button>
              </HorizontalGroup>
              <Text>{selectedIdeConfig.blurb}</Text>
              {selectedIdeConfig.tips.length > 0 && (
                <ul className={styles.bulletList}>
                  {selectedIdeConfig.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              )}
              <div className={styles.promptSummaryRow}>
                <div className={styles.promptContent}>
                  <pre className={styles.promptPreview}>
                    <code>{selectedPrompt}</code>
                  </pre>
                </div>
                <div className={styles.promptIconActions}>
                  <IconButton
                    name="download-alt"
                    variant="secondary"
                    aria-label="Download prompt file"
                    tooltip="Download prompt as a markdown file"
                    className={styles.promptIconButton}
                    onClick={() => downloadTextFile(getInstrumentationPromptFilename(selectedIde), selectedPrompt)}
                  />
                  <IconButton
                    name="copy"
                    variant="secondary"
                    aria-label="Copy prompt to clipboard"
                    tooltip="Copy prompt to your clipboard"
                    className={styles.promptIconButton}
                    onClick={() => void navigator.clipboard.writeText(selectedPrompt)}
                  />
                </div>
              </div>
              <HorizontalGroup justify="flex-end" className={styles.modalActionRow}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (selectedIde === 'cursor') {
                      window.open(cursorDeeplink, '_blank', 'noopener');
                      return;
                    }
                    void navigator.clipboard.writeText(selectedPrompt);
                  }}
                >
                  <span className={styles.instrumentButtonLogo}>{renderIdeActionLogo(selectedIde)}</span>
                  {selectedIde === 'cursor' ? 'Instrument in Cursor' : 'Copy prompt'}
                </Button>
              </HorizontalGroup>
            </Stack>
          </div>
        </div>
      )}
    </>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    panel: css({
      margin: theme.spacing(5, 0, 2),
      width: 'fit-content',
      padding: theme.spacing(2),
      borderRadius: `calc(${theme.shape.radius.default} * 1.25)`,
      background: theme.colors.background.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      display: 'grid',
      gap: theme.spacing(1.25),
    }),
    heading: css({
      margin: 0,
      color: theme.colors.text.primary,
      fontSize: theme.typography.h4.fontSize,
      lineHeight: theme.typography.h4.lineHeight,
      fontWeight: theme.typography.fontWeightBold,
      letterSpacing: '-0.01em',
      textTransform: 'none',
    }),
    ideTabs: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: theme.spacing(1),
      '@media (max-width: 640px)': {
        gridTemplateColumns: '1fr',
      },
    }),
    ideTabButton: css({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing(1),
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.secondary,
      color: theme.colors.text.primary,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      padding: theme.spacing(1),
      cursor: 'pointer',
      '&:hover': {
        borderColor: 'var(--tutorial-accent)',
        background: theme.colors.action.hover,
      },
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.main}`,
        outlineOffset: theme.spacing(0.5),
      },
    }),
    ideTabLogo: css({
      display: 'inline-flex',
      alignItems: 'center',
    }),
    modalBackdrop: css({
      position: 'fixed',
      inset: 0,
      background: 'rgba(5, 8, 13, 0.56)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 999,
      padding: theme.spacing(2),
    }),
    modalCard: css({
      width: '100%',
      maxWidth: 760,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.primary,
      padding: theme.spacing(3),
      boxShadow: theme.shadows.z3,
    }),
    bulletList: css({
      margin: 0,
      paddingLeft: theme.spacing(3),
      display: 'grid',
      gap: theme.spacing(1),
    }),
    promptPreview: css({
      margin: 0,
      maxHeight: 280,
      overflowY: 'auto',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.secondary,
      padding: theme.spacing(1.5),
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 1.5,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      '& code': {
        fontFamily: theme.typography.fontFamilyMonospace,
      },
    }),
    promptSummaryRow: css({
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      alignItems: 'start',
      gap: theme.spacing(1),
    }),
    promptContent: css({
      display: 'grid',
      gap: theme.spacing(1),
    }),
    promptIconActions: css({
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: theme.spacing(0.75),
    }),
    promptIconButton: css({
      width: 32,
      height: 32,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      background: theme.colors.background.primary,
      color: theme.colors.text.secondary,
      '&:hover': {
        borderColor: theme.colors.border.medium,
        background: theme.colors.action.hover,
      },
      '&:focus-visible': {
        boxShadow: `0 0 0 2px ${theme.colors.primary.main}`,
      },
    }),
    modalActionRow: css({
      width: '100%',
      display: 'flex',
      justifyContent: 'flex-end',
    }),
    instrumentButtonLogo: css({
      display: 'inline-flex',
      alignItems: 'center',
      marginRight: theme.spacing(0.5),
      '& svg': {
        width: 20,
        height: 20,
      },
    }),
  };
}
