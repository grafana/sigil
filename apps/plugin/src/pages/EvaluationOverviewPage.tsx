import React, { useDeferredValue, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@emotion/css';
import type { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Alert, Button, Icon, Input, Select, Spinner, Text, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, ROUTES } from '../constants';
import EvalOnboarding from '../components/evaluation/EvalOnboarding';
import RuleTable from '../components/evaluation/RuleTable';
import SummaryCards from '../components/evaluation/SummaryCards';
import { useEvalRulesDataContext } from '../contexts/EvalRulesDataContext';
import { PageInsightBar } from '../components/insight/PageInsightBar';

const EVAL_BASE = `${PLUGIN_BASE}/${ROUTES.Evaluation}`;
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
    gap: theme.spacing(2),
  }),
  loading: css({
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing(4),
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

export default function EvaluationOverviewPage() {
  const styles = useStyles2(getStyles);
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const { rules, evaluators, predefinedCount, loading, errorMessage, setErrorMessage, handleToggle } =
    useEvalRulesDataContext();

  const handleRuleClick = (ruleID: string) => {
    navigate(`${EVAL_BASE}/rules/${encodeURIComponent(ruleID)}`);
  };

  const activeRuleCount = rules.filter((r) => r.enabled).length;
  const disabledRuleCount = rules.length - activeRuleCount;
  const tenantEvalCount = evaluators.filter((e) => !e.is_predefined).length;
  const hasEvaluators = tenantEvalCount > 0;
  const filteredRules = useMemo(
    () => rules.filter((rule) => matchesRule(rule, deferredSearch)),
    [deferredSearch, rules]
  );
  const pageCount = Math.max(1, Math.ceil(filteredRules.length / pageSize));
  const clampedPage = Math.min(page, pageCount - 1);
  const visibleRules = useMemo(() => {
    const start = clampedPage * pageSize;
    return filteredRules.slice(start, start + pageSize);
  }, [clampedPage, filteredRules, pageSize]);

  const evalInsightDataContext = useMemo(() => {
    if (loading || rules.length === 0) {
      return null;
    }
    const ruleNames = rules
      .map((r) => `  ${r.rule_id} (${r.selector}): ${r.enabled ? 'active' : 'disabled'}, sample_rate=${r.sample_rate}`)
      .join('\n');
    return [
      `Total rules: ${rules.length}`,
      `Active rules: ${activeRuleCount}`,
      `Disabled rules: ${disabledRuleCount}`,
      `Tenant evaluators: ${tenantEvalCount}`,
      `Predefined templates: ${predefinedCount}`,
      `Rules:\n${ruleNames}`,
    ].join('\n');
  }, [loading, rules, activeRuleCount, disabledRuleCount, tenantEvalCount, predefinedCount]);

  if (loading) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.loading}>
          <Spinner />
        </div>
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className={styles.pageContainer}>
        {errorMessage.length > 0 && (
          <Alert severity="error" title="Error" onRemove={() => setErrorMessage('')}>
            <Text>{errorMessage}</Text>
          </Alert>
        )}
        <EvalOnboarding
          hasEvaluators={hasEvaluators}
          onGoToEvaluators={() => navigate(`${EVAL_BASE}/evaluators`)}
          onGoToCreateRule={() => navigate(`${EVAL_BASE}/rules/new`)}
        />
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

      <PageInsightBar
        prompt="Analyze this evaluation pipeline overview. Suggest coverage gaps or configuration improvements."
        origin="sigil-plugin/evaluation-insight"
        dataContext={evalInsightDataContext}
      />

      <SummaryCards
        activeRules={activeRuleCount}
        disabledRules={disabledRuleCount}
        totalEvaluators={tenantEvalCount}
        predefinedTemplates={predefinedCount}
        onCreateRule={() => navigate(`${EVAL_BASE}/rules/new`)}
        onBrowseEvaluators={() => navigate(`${EVAL_BASE}/evaluators`)}
      />

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

      {filteredRules.length === 0 ? (
        <div className={styles.filteredEmpty}>
          <Icon name="search" />
          <Text color="secondary">No rules matched this search.</Text>
        </div>
      ) : (
        <>
          <RuleTable rules={visibleRules} evaluators={evaluators} onToggle={handleToggle} onClick={handleRuleClick} />
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
