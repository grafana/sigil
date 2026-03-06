import React, { useDeferredValue, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Alert, Button, Icon, Input, Select, Spinner, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import RuleTable from '../components/evaluation/RuleTable';
import { PageInsightBar } from '../components/insight/PageInsightBar';
import { useEvalRulesDataContext } from '../contexts/EvalRulesDataContext';

const EVAL_RULES_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}/rules`;
const RULE_PAGE_SIZE_OPTIONS: Array<SelectableValue<number>> = [
  { label: '25', value: 25 },
  { label: '50', value: 50 },
  { label: '100', value: 100 },
];

const getStyles = (theme: GrafanaTheme2) => ({
  pageContainer: css({
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    gap: theme.spacing(3),
  }),
  section: css({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.spacing(2),
  }),
  sectionHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
  }),
  sectionDescription: css({
    color: theme.colors.text.secondary,
    marginTop: theme.spacing(-1),
  }),
  searchRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap' as const,
  }),
  searchInput: css({
    width: '100%',
    maxWidth: 360,
  }),
  empty: css({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(6, 4),
    gap: theme.spacing(3),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
  }),
  emptyVisual: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  emptyNode: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    color: theme.colors.text.disabled,
  }),
  emptyNodeCenter: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
    borderRadius: theme.shape.radius.default,
    background: theme.isDark
      ? 'linear-gradient(135deg, rgba(61, 113, 217, 0.15), rgba(61, 113, 217, 0.05))'
      : 'linear-gradient(135deg, rgba(61, 113, 217, 0.1), rgba(61, 113, 217, 0.03))',
    border: `1px solid ${theme.colors.primary.border}`,
    color: theme.colors.primary.text,
  }),
  emptyArrow: css({
    color: theme.colors.border.medium,
    flexShrink: 0,
  }),
  emptyText: css({
    textAlign: 'center' as const,
    maxWidth: 400,
  }),
  emptyHints: css({
    display: 'flex',
    gap: theme.spacing(3),
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
  }),
  emptyHint: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  filteredEmpty: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(2, 2.5),
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    background: theme.colors.background.primary,
    color: theme.colors.text.secondary,
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing(4),
  }),
  paginationBar: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1.5),
    flexWrap: 'wrap' as const,
    paddingTop: theme.spacing(0.5),
  }),
  paginationMeta: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    flexWrap: 'wrap' as const,
    color: theme.colors.text.secondary,
  }),
  paginationControls: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap' as const,
  }),
  pageSizeControl: css({
    minWidth: 88,
  }),
});

export default function RulesPage() {
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();

  const { rules, evaluators, loading, errorMessage, setErrorMessage, handleToggle } = useEvalRulesDataContext();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const filteredRules = useMemo(
    () => rules.filter((rule) => matchesRule(rule, deferredSearch)),
    [deferredSearch, rules]
  );
  const rulesInsightDataContext = useMemo(() => {
    if (loading || rules.length === 0) {
      return null;
    }
    const activeRules = rules.filter((rule) => rule.enabled);
    const selectors = Array.from(new Set(rules.map((rule) => rule.selector))).sort();
    const sampleRates = rules.map((rule) => rule.sample_rate);
    const avgSampleRate = sampleRates.reduce((sum, value) => sum + value, 0) / sampleRates.length;
    return [
      `Total rules: ${rules.length}`,
      `Active rules: ${activeRules.length}`,
      `Disabled rules: ${rules.length - activeRules.length}`,
      `Visible rules: ${filteredRules.length}`,
      `Evaluator options: ${evaluators.length}`,
      `Selectors in use: ${selectors.join(', ') || '(none)'}`,
      `Average sample rate: ${avgSampleRate.toFixed(2)}`,
      `Sample rate range: ${Math.min(...sampleRates).toFixed(2)} to ${Math.max(...sampleRates).toFixed(2)}`,
      `Search query: ${deferredSearch || '(none)'}`,
      `Visible rules: ${
        filteredRules
          .slice(0, 12)
          .map(
            (rule) =>
              `${rule.rule_id} [selector=${rule.selector}, enabled=${rule.enabled}, sample_rate=${rule.sample_rate}, evaluators=${rule.evaluator_ids.join('|') || '(none)'}]`
          )
          .join(', ') || '(none)'
      }`,
    ].join('\n');
  }, [deferredSearch, evaluators.length, filteredRules, loading, rules]);
  const pageCount = Math.max(1, Math.ceil(filteredRules.length / pageSize));
  const clampedPage = Math.min(page, pageCount - 1);
  const visibleRules = useMemo(() => {
    const start = clampedPage * pageSize;
    return filteredRules.slice(start, start + pageSize);
  }, [clampedPage, filteredRules, pageSize]);

  const handleClick = (ruleID: string) => {
    navigate(`${EVAL_RULES_BASE}/${encodeURIComponent(ruleID)}`);
  };

  if (loading) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </div>
    );
  }

  const rangeStart = filteredRules.length === 0 ? 0 : clampedPage * pageSize + 1;
  const rangeEnd = Math.min((clampedPage + 1) * pageSize, filteredRules.length);

  return (
    <div className={styles.pageContainer}>
      {errorMessage.length > 0 && (
        <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
          <Text>{errorMessage}</Text>
        </Alert>
      )}

      {rulesInsightDataContext && (
        <PageInsightBar
          prompt="Analyze this evaluation rules page. Focus on missing traffic coverage, disabled or weakly sampled rules, selector imbalance, and missing evaluator attachments. Call out likely duplicate or overlapping rules only if the context strongly suggests it. Give concrete next steps and skip anything that looks normal."
          origin="sigil-plugin/evaluation-rules-insight"
          dataContext={rulesInsightDataContext}
        />
      )}

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Text element="h3" weight="medium">
            Rules
          </Text>
          {rules.length > 0 && (
            <Button
              variant="primary"
              icon="plus"
              onClick={() => navigate(`${EVAL_RULES_BASE}/new`)}
              aria-label="Create rule"
            >
              Create new rule
            </Button>
          )}
        </div>
        <div className={styles.sectionDescription}>
          <Text variant="bodySmall" color="secondary">
            Rules connect selectors, match criteria, and evaluators into an automated pipeline that scores your LLM
            generations.
          </Text>
        </div>
        {rules.length > 0 && (
          <div className={styles.searchRow}>
            <div className={styles.searchInput}>
              <Input
                prefix={<Icon name="search" />}
                suffix={
                  search.length > 0 ? (
                    <Icon
                      name="times"
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setPage(0);
                        setSearch('');
                      }}
                    />
                  ) : undefined
                }
                value={search}
                placeholder="Search rules..."
                onChange={(event: React.FormEvent<HTMLInputElement>) => {
                  setPage(0);
                  setSearch(event.currentTarget.value);
                }}
              />
            </div>
          </div>
        )}

        {rules.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyVisual}>
              <div className={styles.emptyNode}>
                <Icon name="filter" size="xl" />
              </div>
              <Icon name="arrow-right" size="md" className={styles.emptyArrow} />
              <div className={styles.emptyNodeCenter}>
                <Icon name="sliders-v-alt" size="xl" />
              </div>
              <Icon name="arrow-right" size="md" className={styles.emptyArrow} />
              <div className={styles.emptyNode}>
                <Icon name="check-circle" size="xl" />
              </div>
            </div>
            <div className={styles.emptyText}>
              <Text element="h4" weight="medium">
                Build your evaluation pipeline
              </Text>
              <div style={{ marginTop: 8 }}>
                <Text color="secondary" variant="body">
                  Define which generations to evaluate and how they are scored in real time.
                </Text>
              </div>
            </div>
            <div className={styles.emptyHints}>
              <span className={styles.emptyHint}>
                <Icon name="filter" size="sm" /> Select generations
              </span>
              <span className={styles.emptyHint}>
                <Icon name="percentage" size="sm" /> Sample traffic
              </span>
              <span className={styles.emptyHint}>
                <Icon name="check-circle" size="sm" /> Run evaluators
              </span>
            </div>
            <Button variant="primary" icon="plus" onClick={() => navigate(`${EVAL_RULES_BASE}/new`)}>
              Create your first rule
            </Button>
          </div>
        ) : filteredRules.length === 0 ? (
          <div className={styles.filteredEmpty}>
            <Icon name="search" />
            <Text color="secondary">No rules matched this search.</Text>
          </div>
        ) : (
          <>
            <RuleTable rules={visibleRules} evaluators={evaluators} onToggle={handleToggle} onClick={handleClick} />
            <div className={styles.paginationBar}>
              <div className={styles.paginationMeta}>
                <Text variant="bodySmall" color="secondary">
                  Showing {rangeStart}-{rangeEnd} of {filteredRules.length}
                </Text>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={clampedPage >= pageCount - 1}
                  onClick={() => setPage((prev) => Math.min(prev + 1, pageCount - 1))}
                >
                  Next
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={clampedPage === 0}
                  onClick={() => setPage((prev) => Math.max(prev - 1, 0))}
                >
                  Previous
                </Button>
              </div>
              <div className={styles.paginationControls}>
                <Text variant="bodySmall" color="secondary">
                  Per page
                </Text>
                <Select
                  className={styles.pageSizeControl}
                  options={RULE_PAGE_SIZE_OPTIONS}
                  value={pageSize}
                  onChange={(option) => {
                    const nextValue = option?.value;
                    if (typeof nextValue !== 'number') {
                      return;
                    }
                    setPage(0);
                    setPageSize(nextValue);
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function matchesRule(
  rule: { rule_id: string; selector: string; match: Record<string, string | string[]>; evaluator_ids: string[] },
  needle: string
): boolean {
  if (needle === '') {
    return true;
  }
  const matchText = Object.entries(rule.match)
    .flatMap(([key, value]) => [key, ...(Array.isArray(value) ? value : [value])])
    .join(' ');
  const haystack = [rule.rule_id, rule.selector, ...rule.evaluator_ids, matchText].join(' ').toLowerCase();
  return haystack.includes(needle);
}
