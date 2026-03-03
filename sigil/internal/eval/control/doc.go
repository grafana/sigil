// Package control implements the evaluation control plane: CRUD operations
// for evaluators, rules, and evaluator templates.
//
// Evaluators define how LLM outputs are scored (e.g. LLM-as-judge, regex,
// JSON schema). Rules bind evaluators to traffic via selectors and sampling.
// Templates provide reusable, versioned evaluator configurations that can be
// forked into tenant-specific evaluators.
//
// HTTP handlers are registered via [RegisterHTTPRoutes].
package control
