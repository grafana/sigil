import React from 'react';
import { Icon, type IconName } from '@grafana/ui';
import type { SpanType } from '../../conversation/spans';

type SigilSpanNodeIconProps = {
  type: SpanType;
  className?: string;
};

const ICON_BY_TYPE: Record<SpanType, IconName> = {
  generation: 'cube',
  tool_execution: 'wrench',
  embedding: 'filter',
  framework: 'sitemap',
  unknown: 'circle',
};

export default function SigilSpanNodeIcon({ type, className }: SigilSpanNodeIconProps) {
  return <Icon name={ICON_BY_TYPE[type]} className={className} size="md" />;
}
