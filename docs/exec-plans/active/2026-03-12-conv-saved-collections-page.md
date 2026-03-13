# Saved Conversations Collections Page — Execution Plan

**Status:** complete
**Spec:** `docs/design-docs/2026-03-12-conv-saved-collections-page.md`
**Goal:** Build `/conversations/saved` — browse saved conversations, organize into collections via sidebar + MultiSelect modal.

---

## Chunk 1: Project Wiring

- [x] **1.1** Create `docs/design-docs/2026-03-12-conv-saved-collections-page.md`
- [x] **1.2** Add entry to `docs/design-docs/index.md`
- [x] **1.3** Add entries to `docs/index.md`
- [x] **1.4** Add `ConversationsSaved` route constant to `apps/plugin/src/constants.ts`
- [x] **1.5** Add lazy-loaded route in `apps/plugin/src/app/App.tsx` (before `ConversationsExplore`)
- [x] **1.6** Commit

## Chunk 2: CollectionFormModal

- [x] **2.1–2.5** Implement, test, and add Storybook story for `apps/plugin/src/components/saved-conversations/CollectionFormModal.tsx`
- [x] **2.6** Commit

## Chunk 3: CollectionsSidebar

- [x] **3.1–3.5** Implement, test, and add Storybook story for `apps/plugin/src/components/saved-conversations/CollectionsSidebar.tsx`
- [x] **3.6** Commit

## Chunk 4: SavedConversationsList

- [x] **4.1–4.5** Implement, test, and add Storybook story for `apps/plugin/src/components/saved-conversations/SavedConversationsList.tsx`
- [x] **4.6** Commit

## Chunk 5: AddToCollectionModal

- [x] **5.1–5.5** Implement (MultiSelect-based, no pre-selection, deduplication), test, and add Storybook story for `apps/plugin/src/components/saved-conversations/AddToCollectionModal.tsx`
- [x] **5.6** Commit

## Chunk 6: SavedConversationsPage

- [x] **6.1–6.8** Implement, test, add Storybook story, lint, typecheck, and commit `apps/plugin/src/pages/SavedConversationsPage.tsx`

## Final Verification

- [ ] Navigate to `http://localhost:3000/a/grafana-sigil-app/conversations/saved` (stack via `mise run up`)
- [ ] Verify page loads with sidebar and conversation list
- [ ] Verify clicking a collection filters the list
- [ ] Verify creating a collection via "+ New collection" works
- [ ] Verify renaming a collection inline works
- [ ] Verify deleting a collection with confirm works
- [ ] Verify multi-select + "Add to collection" dialog works
- [ ] Verify "Remove" removes conversations from the active collection
- [ ] Verify clicking a conversation name opens it in a new tab
