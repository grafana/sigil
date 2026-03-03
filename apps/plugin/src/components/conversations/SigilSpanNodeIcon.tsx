import React from 'react';
import { Icon, type IconName } from '@grafana/ui';
import type { SigilSpanKind } from '../../conversation/traceSpans';

type SigilSpanNodeIconProps = {
  kind: SigilSpanKind;
  className?: string;
};

const ICON_BY_KIND: Record<SigilSpanKind, IconName> = {
  generation: 'cube',
  tool: 'wrench',
  model: 'filter',
  evaluation: 'check-circle',
  other: 'circle',
};

export default function SigilSpanNodeIcon({ kind, className }: SigilSpanNodeIconProps) {
  return <Icon name={ICON_BY_KIND[kind]} className={className} size="md" />;
}
