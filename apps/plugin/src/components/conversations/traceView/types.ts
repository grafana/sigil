// Ported from Grafana's TraceView (Apache 2.0)
// Simplified types for the trace timeline layout components.

export type TNil = null | undefined;

export type ViewedBoundsFunctionType = (start: number, end: number) => { start: number; end: number };
