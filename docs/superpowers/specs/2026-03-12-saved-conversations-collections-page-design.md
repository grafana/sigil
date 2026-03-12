# Saved Conversations Collections Page — Design Spec

**Date:** 2026-03-12
**Status:** Approved
**Route:** `conversations/saved`

## Overview

A dedicated page at `/a/grafana-sigil-app/conversations/saved` where users can browse all their saved conversations and organize them into named collections. The page is not linked from the nav yet — it is a standalone route added in this iteration.

The primary jobs are **organization** (putting conversations into collections) and **discovery** (finding conversations by filtering to a collection), weighted equally.

## Page Structure

### Layout

Two-column layout inside the standard Grafana `PluginPage` with `background="canvas"`. The page gets the same full-bleed, header-hidden treatment as other conversation routes automatically — the existing `shouldHidePluginHeader` and `shouldUseFullBleedPageInner` checks in `App.tsx` already match because they use `pathname.includes('/conversations')`. No changes to those checks are needed.

**Left sidebar (200px fixed):**
- "All saved" item at the top — always present, shows total count badge, selected by default on load.
- "Collections" section label.
- One entry per collection: name + member count. Hover reveals a ⋯ kebab icon.
- ⋯ menu items: Rename, Delete.
- "Rename" turns the sidebar item into an inline text input (no modal).
- "Delete" opens a confirm modal.
- "+ New collection" button pinned to the bottom of the sidebar.
- Sidebar scrolls independently if collections overflow.

**Main area (flex: 1):**
- Search input + selection toolbar row.
- Column header row: checkbox (select-all), Name, Saved by, Date.
- Conversation rows — compact, one line each.
- Cursor-based pagination footer.

### Routing

Add to `constants.ts`:
```ts
ConversationsSaved: 'conversations/saved',
```

Add a lazy-loaded route in `App.tsx` **before `ROUTES.ConversationsExplore` and before the catch-all `<Route path="*" />`**. Order matters: React Router v6 would match `conversations/:conversationID/explore` on the literal string `"saved"` if that route appears first:

```tsx
<Route path={ROUTES.ConversationsSaved} element={
  <div className={styles.conversationsRouteContainer}>
    <SavedConversationsPage />
  </div>
} />
// ... ConversationsExplore route follows below this
```

No nav link or sidebar entry is added in this iteration.

## Main List

### Columns

| Column | Content |
|---|---|
| Checkbox | Row selection toggle |
| Name | `SavedConversation.name` — clicking opens the conversation explore page in a new tab |
| Saved by | `SavedConversation.saved_by` — display `—` if the value is an empty string |
| Date | `SavedConversation.created_at` formatted as `dateTime(created_at).format('MMM D, YYYY')` using `dateTime` from `@grafana/data` |

### Behavior

- **Select-all checkbox** in the column header selects/deselects all rows on the current page.
- Clicking a conversation **name** opens the explore page in a new tab: `window.open(\`${PLUGIN_BASE}/${buildConversationExploreRoute(row.conversation_id)}\`, '_blank')`. `PLUGIN_BASE` (`/a/grafana-sigil-app`) is required for the absolute URL to resolve correctly. The field used is `conversation_id` from `SavedConversation`, not `saved_id`.
- **When "All saved" is active**: call `listSavedConversations()` with cursor pagination.
- **When a collection is active**: call `listCollectionMembers(collectionID)` with cursor pagination. `CollectionMembersResponse.items` is `SavedConversation[]`.
- **Search**: client-side filter on `name` for the current page of results. No server-side search in this iteration.
- Rows display newest first (API default).

### Selection toolbar

When one or more rows are checked, a toolbar appears inline in the search bar row (replaces the search input area):

```
[2 selected]  |  Add to collection ›  |  Remove
```

- **Add to collection**: opens the Add to Collection dialog.
- **Remove**: removes the selected conversations from the **currently active collection** (calls `removeCollectionMember` for each selected `saved_id`). Hidden when "All saved" is active.
- Clearing selection (unchecking all) dismisses the toolbar and restores the search input.

## Sidebar Interactions

### Collection selection

Clicking a collection sets it as the active filter. The main list re-fetches using `listCollectionMembers`. Clicking "All saved" clears the filter.

### Rename (inline)

Clicking "Rename" from the ⋯ menu replaces the sidebar item text with a controlled `<input>` pre-filled with the current name. Pressing Enter or clicking the checkmark calls `updateCollection(id, { name, updated_by: 'user' })`. Only `name` is sent — `description` is not changed by the rename flow. Pressing Escape cancels. Empty name is rejected client-side (input border turns red). On failure, the input reverts to the previous name and an error alert is shown.

`updated_by` uses the same hardcoded `'user'` convention as `created_by` (see below).

### Delete

Clicking "Delete" from the ⋯ menu opens a `ConfirmModal` (Grafana UI):

- Title: `Delete collection`
- Body: `Delete "[name]"? This removes the collection and its [n] membership links. The conversations themselves will not be deleted.`
- Confirm button label: `Delete collection` (destructive red)
- On confirm: call `deleteCollection(id)`. If the deleted collection was active, switch to "All saved".

### New collection

The "+ New collection" sidebar button opens a `Modal` with:
- **Name** field (required, max 255 chars)
- **Description** field (optional textarea)
- Cancel / Create buttons
- On submit: call `createCollection({ name, description, created_by: 'user' })`.

`created_by` uses the hardcoded string `'user'`, consistent with how `saved_by` is populated in `useSavedConversation.ts`. This is a known placeholder until proper user resolution is implemented across the plugin.

On success, add the new collection to the sidebar list and select it.

## Add to Collection Dialog

Opened when user has 1+ rows selected and clicks "Add to collection" in the toolbar.

### Data sources

- The **checklist of collections** is sourced from the already-loaded `collections` state (the full sidebar list). No additional fetch needed.
- The **current membership** of each selected conversation is determined by calling `listCollectionsForSavedConversation(savedID)` for each selected row on dialog open. This call is cursor-paginated — follow `next_cursor` to exhaustion for each conversation to get complete membership.

### Concurrency

Fan-out calls are batched: fire at most 20 `listCollectionsForSavedConversation` requests in parallel, then the next batch of 20, until all selected conversations are resolved.

### Checkbox states

After loading membership data, build a `Map<collectionID, Set<savedID>>` — which selected conversations are already in each collection. Use this to determine:

- **Checked** (✓): all selected conversations are in this collection.
- **Partial** (–): only some selected conversations are in this collection.
- **Unchecked**: none of the selected conversations are in this collection.

The `Map<collectionID, Set<savedID>>` is kept in local dialog state and used at Save time to compute the minimal diff.

### Save behavior

For each collection whose checkbox state changed:

- **Newly checked** (was unchecked or partial, now checked): call `addCollectionMembers(collectionID, { saved_ids: [...], added_by: 'user' })` with the selected conversation IDs not already in the collection (i.e., those absent from `membershipMap.get(collectionID)`).
- **Newly unchecked** (was checked or partial, now unchecked): call `removeCollectionMember(collectionID, savedID)` for each selected conversation that was in the collection (i.e., those present in `membershipMap.get(collectionID)`).
- **Unchanged**: no-op.

Add/remove calls within a Save fire in parallel (no batching needed — count is bounded by collections × selected rows, which is typically small).

### Create new collection inline

A "Create new collection" link at the bottom of the checklist opens `CollectionFormModal`. On creation, the new collection is appended to the checklist (and to the main `collections` state) and pre-checked.

On dialog Save success: close dialog, re-fetch sidebar counts (`listCollections`), re-fetch main list if a collection filter is active.

## State Management

All state is local to the page component (no global store). Uses `useState` + `useEffect`, consistent with `EvaluatorsPage` and `RulesPage`.

Key state in `SavedConversationsPage`:

| State | Type | Notes |
|---|---|---|
| `collections` | `Collection[]` | Loaded on mount by following all `next_cursor` pages of `listCollections`. Truncates silently at 200 items. |
| `activeCollectionID` | `string \| null` | `null` = "All saved" |
| `conversations` | `SavedConversation[]` | Current page |
| `selectedIDs` | `Set<string>` | Keyed by `saved_id` |
| `cursor` | `string \| undefined` | Pagination cursor |
| `totalCount` | `number \| undefined` | From list response |
| `isLoading` | `boolean` | |
| `error` | `string \| undefined` | |

## Components

All new files live under `apps/plugin/src/`:

| File | Description |
|---|---|
| `pages/SavedConversationsPage.tsx` | Page root — layout, sidebar, orchestration |
| `components/saved-conversations/CollectionsSidebar.tsx` | Left sidebar: list, rename inline, new/delete actions |
| `components/saved-conversations/SavedConversationsList.tsx` | Main list: column headers, rows, pagination |
| `components/saved-conversations/AddToCollectionModal.tsx` | Checklist modal for assigning conversations to collections |
| `components/saved-conversations/CollectionFormModal.tsx` | Create / (future: edit) collection name + description |

Each component gets a Storybook story in `*.stories.tsx` alongside it.

## Error Handling

- API errors surface as a Grafana `Alert` (variant `error`) inline below the toolbar.
- Optimistic UI is not used — wait for API responses before updating state.
- Failed renames revert the inline input to the previous name and show an alert.
- Failed deletes close the modal and show an alert.
- Dialog save errors surface inline within the dialog (do not close on failure).

## Out of Scope (This Iteration)

- Nav link / sidebar entry to the page
- Server-side search
- Unsaving (deleting) conversations from "All saved" view
- Drag-and-drop (can be added later; the layout supports it)
- Bulk create-collection-and-add-in-one-step beyond the inline flow in the dialog
- Collection reordering
- Real user identity for `created_by` / `updated_by` / `added_by`
