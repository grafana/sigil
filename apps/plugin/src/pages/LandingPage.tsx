import React, { useCallback, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { LinkButton, Text, useStyles2 } from '@grafana/ui';
import { TopStat } from '../components/TopStat';
import { DashboardSummaryBar } from '../components/dashboard/DashboardSummaryBar';
import { usePrometheusQuery } from '../components/dashboard/usePrometheusQuery';
import { useResolvedModelPricing } from '../components/dashboard/useResolvedModelPricing';
import { extractResolvePairs, formatWindowLabel } from '../components/dashboard/dashboardShared';
import { LandingTopBar, type HeroStatItem } from '../components/landing/LandingTopBar';
import { PLUGIN_BASE, ROUTES } from '../constants';
import { defaultDashboardDataSource } from '../dashboard/api';
import { calculateTotalCost } from '../dashboard/cost';
import {
  computeRangeDuration,
  computeStep,
  computeRateInterval,
  requestsOverTimeQuery,
  totalOpsQuery,
  totalTokensQuery,
  totalTokensOverTimeQuery,
  tokensByModelAndTypeQuery,
} from '../dashboard/queries';
import { vectorToStatValue } from '../dashboard/transforms';
import { type PrometheusMatrixResult, emptyFilters } from '../dashboard/types';

const ASSISTANT_ORIGIN = 'grafana/sigil-plugin/landing';
const CHART_WINDOW_SECONDS = 24 * 60 * 60;

function matrixToSparklineValues(data: { data: { resultType: string; result: unknown[] } } | null): number[] {
  if (!data || data.data.resultType !== 'matrix') {
    return [];
  }
  const results = data.data.result as PrometheusMatrixResult[];
  if (results.length === 0) {
    return [];
  }
  return results[0].values.map(([, v]) => parseFloat(v));
}

export default function LandingPage() {
  const styles = useStyles2(getStyles);
  const [to] = useState(() => Math.floor(Date.now() / 1000));
  const from = to - CHART_WINDOW_SECONDS;
  const rangeDuration = useMemo(() => computeRangeDuration(from, to), [from, to]);

  const windowSize = to - from;
  const prevFrom = from - windowSize;
  const prevTo = to - windowSize;
  const comparisonLabel = `previous ${formatWindowLabel(windowSize)}`;

  const step = useMemo(() => computeStep(from, to), [from, to]);
  const rateInterval = useMemo(() => computeRateInterval(step), [step]);

  const [heroStats, setHeroStats] = useState<HeroStatItem[]>([]);
  const handleHeroStats = useCallback((stats: HeroStatItem[]) => setHeroStats(stats), []);

  const totalRequests = usePrometheusQuery(
    defaultDashboardDataSource,
    totalOpsQuery(emptyFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const totalTokens = usePrometheusQuery(
    defaultDashboardDataSource,
    totalTokensQuery(emptyFilters, rangeDuration),
    from,
    to,
    'instant'
  );
  const costTokens = usePrometheusQuery(
    defaultDashboardDataSource,
    tokensByModelAndTypeQuery(emptyFilters, rangeDuration, 'none'),
    from,
    to,
    'instant'
  );

  const prevTotalRequests = usePrometheusQuery(
    defaultDashboardDataSource,
    totalOpsQuery(emptyFilters, rangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevTotalTokens = usePrometheusQuery(
    defaultDashboardDataSource,
    totalTokensQuery(emptyFilters, rangeDuration),
    prevFrom,
    prevTo,
    'instant'
  );
  const prevCostTokens = usePrometheusQuery(
    defaultDashboardDataSource,
    tokensByModelAndTypeQuery(emptyFilters, rangeDuration, 'none'),
    prevFrom,
    prevTo,
    'instant'
  );

  const requestsOverTime = usePrometheusQuery(
    defaultDashboardDataSource,
    requestsOverTimeQuery(emptyFilters, rateInterval, 'none'),
    from,
    to,
    'range',
    step
  );
  const tokensOverTime = usePrometheusQuery(
    defaultDashboardDataSource,
    totalTokensOverTimeQuery(emptyFilters, rateInterval, 'none'),
    from,
    to,
    'range',
    step
  );

  const requestsSparkline = useMemo(() => matrixToSparklineValues(requestsOverTime.data), [requestsOverTime.data]);
  const tokensSparkline = useMemo(() => matrixToSparklineValues(tokensOverTime.data), [tokensOverTime.data]);

  const costTokensData = costTokens.data ?? undefined;
  const prevCostTokensData = prevCostTokens.data ?? undefined;
  const resolvePairs = useMemo(() => extractResolvePairs(costTokensData), [costTokensData]);
  const resolvedPricing = useResolvedModelPricing(defaultDashboardDataSource, resolvePairs);

  const totalCost = useMemo(
    () => calculateTotalCost(costTokensData, resolvedPricing.pricingMap),
    [costTokensData, resolvedPricing.pricingMap]
  );
  const prevTotalCost = useMemo(
    () => calculateTotalCost(prevCostTokensData, resolvedPricing.pricingMap),
    [prevCostTokensData, resolvedPricing.pricingMap]
  );

  return (
    <div className={styles.container}>
      <LandingTopBar
        assistantOrigin={ASSISTANT_ORIGIN}
        requestsDataSource={defaultDashboardDataSource}
        requestsFrom={from}
        requestsTo={to}
        onHeroStats={handleHeroStats}
        spineHeights={requestsSparkline}
      />
      <section className={styles.section} aria-label="Analytics overview highlights">
        <div className={styles.sectionHeader}>
          <LinkButton
            href={`${PLUGIN_BASE}/${ROUTES.Analytics}?tab=overview`}
            variant="secondary"
            fill="outline"
            size="md"
          >
            Go to analytics
          </LinkButton>
          <div className={styles.timeLabel}>
            <Text color="secondary">Highlights from the last 24 hours</Text>
          </div>
        </div>
        <DashboardSummaryBar>
          <TopStat
            label="Total Requests"
            value={totalRequests.data ? vectorToStatValue(totalRequests.data) : 0}
            loading={totalRequests.loading}
            prevValue={prevTotalRequests.data ? vectorToStatValue(prevTotalRequests.data) : undefined}
            prevLoading={prevTotalRequests.loading}
            comparisonLabel={comparisonLabel}
            to={`${PLUGIN_BASE}/${ROUTES.Analytics}?tab=overview`}
            size="large"
            sparklineData={requestsSparkline}
          />
          <TopStat
            label="Total Tokens"
            value={totalTokens.data ? vectorToStatValue(totalTokens.data) : 0}
            unit="short"
            loading={totalTokens.loading}
            prevValue={prevTotalTokens.data ? vectorToStatValue(prevTotalTokens.data) : undefined}
            prevLoading={prevTotalTokens.loading}
            comparisonLabel={comparisonLabel}
            to={`${PLUGIN_BASE}/${ROUTES.Analytics}?tab=usage`}
            size="large"
            sparklineData={tokensSparkline}
          />
          <TopStat
            label="Total Estimated Cost"
            value={totalCost.totalCost}
            unit="currencyUSD"
            loading={costTokens.loading || resolvedPricing.loading}
            prevValue={prevTotalCost.totalCost}
            prevLoading={prevCostTokens.loading}
            invertChange
            comparisonLabel={comparisonLabel}
            to={`${PLUGIN_BASE}/${ROUTES.Analytics}?tab=usage`}
            size="large"
            sparklineData={tokensSparkline}
          />
          {heroStats.map((item) => (
            <TopStat
              key={item.label}
              label={item.label}
              value={item.current}
              loading={item.loading}
              prevValue={item.previous}
              prevLoading={false}
              comparisonLabel={comparisonLabel}
              to={`${PLUGIN_BASE}/${item.route}`}
              size="large"
              sparklineData={item.sparklineData ?? []}
            />
          ))}
        </DashboardSummaryBar>
      </section>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
    }),
    section: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
      width: '100%',
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(2.5),
    }),
    timeLabel: css({
      opacity: 0.7,
    }),
    sectionHeader: css({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: theme.spacing(1),
    }),
  };
}
