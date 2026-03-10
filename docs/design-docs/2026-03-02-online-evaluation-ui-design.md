---
owner: sigil-core
status: active
last_reviewed: 2026-03-02
---

# Online Evaluation UI Design

## Goal

Add a full "Evaluation" section to the Grafana plugin that lets operators manage evaluators, configure rules with pipeline visualization, and preview rule matching via dry-run against recent traffic.

## Architecture

Two-level navigation under a single "Evaluation" nav entry with tab-bar sub-navigation (Overview, Evaluators, Rules). Config-centric CRUD with pipeline visualization available on both the overview and rules pages.

### Navigation

| URL | View |
|-----|------|
| `/a/grafana-sigil-app/evaluation` | Overview (pipeline/summary toggle) |
| `/a/grafana-sigil-app/evaluation/evaluators` | Evaluator catalog + management |
| `/a/grafana-sigil-app/evaluation/rules` | Rule list with pipeline cards |
| `/a/grafana-sigil-app/evaluation/rules/new` | Rule creation with dry-run preview |
| `/a/grafana-sigil-app/evaluation/rules/:id` | Rule edit with dry-run preview |

### Overview Page

Toggles between two views via `RadioButtonGroup`:

- **Pipeline view**: Each active rule rendered as a horizontal flow card (selector -> match -> sample -> evaluators).
- **Summary view**: Metric cards (active rules, evaluators, templates) with quick action buttons.

### Evaluators Page

Two sections:

- **Template Library**: Grid of predefined evaluator template cards with Fork action.
- **Tenant Evaluators**: Table of user-created evaluators with detail view and create/delete actions.

### Rules Page

List of rules as pipeline cards with inline enable/disable toggle. Create Rule button navigates to rule creation.

### Rule Detail Page

Two-column layout:

- **Left**: Stepped form with Rule ID, Selector picker, Match criteria editor, Sample rate input, Evaluator picker.
- **Right**: Dry-run preview panel showing matching generations from the last N hours (configurable server-side, default 6h). Preview auto-updates on criteria change (debounced 500ms).

## Backend Changes

### Plugin Proxy Routes

All eval control-plane endpoints proxied through the plugin backend at `/eval/*` prefix, forwarding to Sigil `/api/v1/eval/*`.

### New Endpoint: `POST /api/v1/eval/rules:preview`

Accepts rule criteria (selector, match, sample_rate), queries generations from the last `SIGIL_EVAL_PREVIEW_WINDOW_HOURS` (default 6), applies selector + matcher + sampler logic, and returns counts and sample generations.

## Component Architecture

- Leaf components: PipelineNode, PipelineCard, SummaryCards, EvaluatorTemplateCard/Grid, EvaluatorTable, EvaluatorDetail, SelectorPicker, MatchCriteriaEditor, SampleRateInput, EvaluatorPicker, DryRunPreview, RuleEnableToggle, ForkEvaluatorForm, EvaluatorForm
- Composite: RuleForm, EvalTabBar
- Pages: EvaluationPage (wrapper), EvaluationOverviewPage, EvaluatorsPage, RulesPage, RuleDetailPage

Every component has a Storybook story with mock data.

## Data Flow

```
Plugin Frontend -> getBackendSrv().fetch() -> Plugin Backend Proxy -> Sigil API
```

TypeScript types mirror the backend API shapes. The `EvaluationDataSource` type enables dependency injection for Storybook mocking.
