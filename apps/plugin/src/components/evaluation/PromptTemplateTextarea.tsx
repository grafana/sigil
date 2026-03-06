import React, { useLayoutEffect, useRef } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

export type PromptTemplateTextareaProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

function highlightTemplateVars(text: string, templateVarClass: string): React.ReactNode {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) => {
    if (/^\{\{[^}]+\}\}$/.test(part)) {
      return (
        <span key={i} className={templateVarClass}>
          {part}
        </span>
      );
    }
    return part;
  });
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    position: 'relative',
    width: '100%',
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.medium}`,
    background: theme.colors.background.canvas,
    overflow: 'hidden',
    '&:focus-within': {
      borderColor: theme.colors.primary.border,
    },
  }),
  textarea: css({
    position: 'relative',
    zIndex: 1,
    display: 'block',
    boxSizing: 'border-box',
    margin: 0,
    width: '100%',
    minHeight: 180,
    padding: theme.spacing(1, 2),
    fontSize: theme.typography.body.fontSize,
    lineHeight: theme.typography.body.lineHeight,
    border: 'none',
    background: 'transparent',
    color: theme.colors.text.primary,
    caretColor: theme.colors.text.primary,
    resize: 'none' as const,
    overflow: 'hidden',
    outline: 'none',
    fontFamily: theme.typography.fontFamilyMonospace,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  }),
  overlay: css({
    position: 'absolute',
    inset: 0,
    boxSizing: 'border-box',
    padding: theme.spacing(1, 2),
    fontSize: theme.typography.body.fontSize,
    lineHeight: theme.typography.body.lineHeight,
    color: 'transparent',
    fontFamily: theme.typography.fontFamilyMonospace,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    pointerEvents: 'none',
    overflow: 'hidden',
  }),
  placeholder: css({
    color: theme.colors.text.secondary,
  }),
  templateVar: css({
    color: 'transparent',
    background: theme.colors.warning.transparent,
    borderRadius: theme.shape.radius.default,
    boxShadow: `inset 0 0 0 1px ${theme.colors.warning.border}`,
  }),
});

export default function PromptTemplateTextarea({ value, onChange, placeholder }: PromptTemplateTextareaProps) {
  const styles = useStyles2(getStyles);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = '0px';
    el.style.height = `${Math.max(el.scrollHeight, 180)}px`;
  }, [value]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.overlay}>
        {value.length > 0 ? (
          highlightTemplateVars(value, styles.templateVar)
        ) : (
          <span className={styles.placeholder}>{placeholder}</span>
        )}
      </div>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        spellCheck={false}
      />
    </div>
  );
}
