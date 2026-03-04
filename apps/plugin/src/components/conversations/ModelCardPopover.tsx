import React, { useCallback, useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { ModelCard } from '../../modelcard/types';
import ModelCardContent from './ModelCardContent';

export type ModelCardPopoverProps = {
  card: ModelCard;
  onClose: () => void;
  anchorRect?: DOMRect | null;
};

const getStyles = (theme: GrafanaTheme2) => ({
  backdrop: css({
    position: 'fixed',
    inset: 0,
    zIndex: theme.zIndex.modal,
  }),
  popover: css({
    position: 'fixed',
    zIndex: theme.zIndex.modal + 1,
    boxShadow: theme.shadows.z3,
    overflowY: 'auto',
  }),
});

export default function ModelCardPopover({ card, onClose, anchorRect = null }: ModelCardPopoverProps) {
  const styles = useStyles2(getStyles);
  const popoverRef = useRef<HTMLDivElement>(null);

  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight;
  const cardWidth = Math.min(360, Math.max(300, viewportWidth - 16));
  const estimatedCardHeight = 520;
  const minEdgePadding = 8;
  const anchorLeft = anchorRect?.left ?? minEdgePadding;
  const anchorTop = anchorRect?.top ?? minEdgePadding;
  const anchorBottom = anchorRect?.bottom ?? minEdgePadding;
  const popupGap = 8;
  const maxLeft = viewportWidth - cardWidth - minEdgePadding;
  const left = Math.min(Math.max(anchorLeft, minEdgePadding), Math.max(maxLeft, minEdgePadding));
  const preferredTop = anchorBottom + popupGap;
  const fitsBelow = preferredTop + estimatedCardHeight <= viewportHeight - minEdgePadding;
  const top = fitsBelow
    ? preferredTop
    : Math.max(
        minEdgePadding,
        Math.min(anchorTop - popupGap - estimatedCardHeight, viewportHeight - estimatedCardHeight - minEdgePadding)
      );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <>
      <div className={styles.backdrop} onClick={handleBackdropClick} />
      <div
        ref={popoverRef}
        className={styles.popover}
        style={{
          top,
          left,
          width: cardWidth,
          maxHeight: viewportHeight - minEdgePadding * 2,
        }}
      >
        <ModelCardContent card={card} onClose={onClose} />
      </div>
    </>
  );
}
