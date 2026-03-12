# Saved Conversations Collections Page

**Status:** active
**Date:** 2026-03-12
**Spec:** `docs/superpowers/specs/2026-03-12-saved-conversations-collections-page-design.md`
**Plan:** `docs/exec-plans/active/2026-03-12-conv-saved-collections-page.md`

## Summary

A dedicated page at `/conversations/saved` for browsing and organizing saved conversations into named collections. Sidebar-filter + multi-select-assignment layout. Not linked from nav in this iteration.

## Key Decisions

- Route: `conversations/saved` (conversation domain, not evaluation domain)
- Layout: fixed left sidebar (200px) + flex main list
- Collections are many-to-many; assignment via checklist modal
- All state local to page component; no global store
- `created_by` / `updated_by` / `added_by` use `'user'` placeholder (consistent with rest of plugin)
