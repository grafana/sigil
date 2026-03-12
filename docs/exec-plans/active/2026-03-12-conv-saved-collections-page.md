# Saved Conversations Collections Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone `/conversations/saved` page where users can browse all saved conversations and organize them into named collections via a sidebar-filter + multi-select-assignment UI.

**Architecture:** Five focused components (`CollectionFormModal`, `CollectionsSidebar`, `SavedConversationsList`, `AddToCollectionModal`, `SavedConversationsPage`) under `apps/plugin/src/components/saved-conversations/`. All state is local to the page. Existing `EvaluationDataSource` API methods cover all backend calls — no new API work needed.

**Tech Stack:** TypeScript, React, `@grafana/ui`, `@grafana/data`, `@grafana/runtime`, Emotion CSS (`useStyles2`), `@testing-library/react`, Storybook

**Spec:** `docs/superpowers/specs/2026-03-12-saved-conversations-collections-page-design.md`

---

## Chunk 1: Project Wiring

Files touched in this chunk:
- Create: `docs/design-docs/2026-03-12-conv-saved-collections-page.md`
- Modify: `docs/design-docs/index.md`
- Modify: `docs/index.md`
- Modify: `apps/plugin/src/constants.ts`
- Modify: `apps/plugin/src/app/App.tsx`

---

- [ ] **1.1 Create the project design doc**

Create `docs/design-docs/2026-03-12-conv-saved-collections-page.md`:

```markdown
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
```

- [ ] **1.2 Add entry to design-docs/index.md**

In `docs/design-docs/index.md`, add before the `## Drafts` section:
```markdown
- [`2026-03-12-conv-saved-collections-page.md`](2026-03-12-conv-saved-collections-page.md) (active)
```

- [ ] **1.3 Add entries to docs/index.md**

In `docs/index.md`, under the design-docs list, add:
```
  - Saved conversations collections page (active): `design-docs/2026-03-12-conv-saved-collections-page.md`
```

Under the execution plans active list, add:
```
    - Saved conversations collections page: `exec-plans/active/2026-03-12-conv-saved-collections-page.md`
```

- [ ] **1.4 Add the route constant**

In `apps/plugin/src/constants.ts`, add to the `ROUTES` object after `ConversationsExplore`:

```ts
ConversationsSaved: 'conversations/saved',
```

- [ ] **1.5 Add the route in App.tsx**

In `apps/plugin/src/app/App.tsx`:

1. Add the lazy import near the other lazy imports:
```tsx
const SavedConversationsPage = React.lazy(() => import('../pages/SavedConversationsPage'));
```

2. Add the route **before** the `ConversationsExplore` route (React Router v6 matches `conversations/:id/explore` on the literal `"saved"` if listed first):
```tsx
<Route
  path={ROUTES.ConversationsSaved}
  element={
    <div className={styles.conversationsRouteContainer}>
      <SavedConversationsPage />
    </div>
  }
/>
```

Note: no changes to `shouldHidePluginHeader` or `shouldUseFullBleedPageInner` — they already use `pathname.includes('/conversations')` which covers this route.

- [ ] **1.6 Commit**

```bash
git add docs/design-docs/2026-03-12-conv-saved-collections-page.md \
        docs/design-docs/index.md \
        docs/index.md \
        apps/plugin/src/constants.ts \
        apps/plugin/src/app/App.tsx
git commit -m "feat(plugin): add conversations/saved route and wiring"
```

---

## Chunk 2: CollectionFormModal

A simple controlled modal for creating a new collection (name + optional description). Used by both the sidebar "New collection" button and the AddToCollectionModal's inline "Create new collection" flow.

Files:
- Create: `apps/plugin/src/components/saved-conversations/CollectionFormModal.tsx`
- Create: `apps/plugin/src/components/saved-conversations/CollectionFormModal.test.tsx`
- Create: `apps/plugin/src/stories/saved-conversations/CollectionFormModal.stories.tsx`

---

- [ ] **2.1 Write the failing test**

Create `apps/plugin/src/components/saved-conversations/CollectionFormModal.test.tsx`:

```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CollectionFormModal } from './CollectionFormModal';

describe('CollectionFormModal', () => {
  const onSubmit = jest.fn();
  const onClose = jest.fn();

  beforeEach(() => {
    onSubmit.mockReset();
    onClose.mockReset();
  });

  it('renders name and description fields when open', () => {
    render(<CollectionFormModal isOpen onSubmit={onSubmit} onClose={onClose} />);
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
  });

  it('disables Create button when name is empty', () => {
    render(<CollectionFormModal isOpen onSubmit={onSubmit} onClose={onClose} />);
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });

  it('enables Create button when name is non-empty', () => {
    render(<CollectionFormModal isOpen onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'My collection' } });
    expect(screen.getByRole('button', { name: /create/i })).not.toBeDisabled();
  });

  it('calls onSubmit with name and description on Create click', async () => {
    onSubmit.mockResolvedValue(undefined);
    render(<CollectionFormModal isOpen onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'My collection' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Some notes' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'My collection', description: 'Some notes' }));
  });

  it('calls onClose on Cancel click', () => {
    render(<CollectionFormModal isOpen onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error message when onSubmit rejects', async () => {
    onSubmit.mockRejectedValue(new Error('server error'));
    render(<CollectionFormModal isOpen onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Fail' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
```

- [ ] **2.2 Run the test to confirm it fails**

```bash
cd apps/plugin && pnpm exec jest --testPathPattern=CollectionFormModal --watchAll=false 2>&1 | tail -20
```

Expected: FAIL — `CollectionFormModal` not found.

- [ ] **2.3 Implement CollectionFormModal**

Create `apps/plugin/src/components/saved-conversations/CollectionFormModal.tsx`:

```tsx
import React, { useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Input, Modal, TextArea, useStyles2 } from '@grafana/ui';

export type CollectionFormValues = {
  name: string;
  description?: string;
};

export type CollectionFormModalProps = {
  isOpen: boolean;
  onSubmit: (values: CollectionFormValues) => Promise<void>;
  onClose: () => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  body: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  field: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  label: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  required: css({
    color: theme.colors.error.text,
    marginLeft: theme.spacing(0.5),
  }),
  footer: css({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  }),
});

export function CollectionFormModal({ isOpen, onSubmit, onClose }: CollectionFormModalProps) {
  const styles = useStyles2(getStyles);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const handleClose = () => {
    setName('');
    setDescription('');
    setError(undefined);
    onClose();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await onSubmit({ name: name.trim(), description: description.trim() || undefined });
      setName('');
      setDescription('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create collection');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="New collection" isOpen={isOpen} onDismiss={handleClose}>
      <div className={styles.body}>
        {error && <Alert title={error} severity="error" />}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="collection-name">
            Name<span className={styles.required}>*</span>
          </label>
          <Input
            id="collection-name"
            aria-label="Name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            maxLength={255}
            placeholder="Collection name"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="collection-desc">
            Description <span style={{ color: 'inherit', opacity: 0.5 }}>(optional)</span>
          </label>
          <TextArea
            id="collection-desc"
            aria-label="Description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            placeholder="Add a description..."
            rows={3}
          />
        </div>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={submitting || name.trim() === ''}
          >
            {submitting ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **2.4 Run tests to confirm they pass**

```bash
cd apps/plugin && pnpm exec jest --testPathPattern=CollectionFormModal --watchAll=false 2>&1 | tail -20
```

Expected: PASS — 5 tests pass.

- [ ] **2.5 Write Storybook story**

Create `apps/plugin/src/stories/saved-conversations/CollectionFormModal.stories.tsx`:

```tsx
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CollectionFormModal } from '../../components/saved-conversations/CollectionFormModal';

const meta: Meta<typeof CollectionFormModal> = {
  title: 'SavedConversations/CollectionFormModal',
  component: CollectionFormModal,
};
export default meta;
type Story = StoryObj<typeof CollectionFormModal>;

export const Default: Story = {
  args: {
    isOpen: true,
    onSubmit: async (values) => { console.log('submit', values); },
    onClose: () => {},
  },
};

export const Submitting: Story = {
  args: {
    isOpen: true,
    onSubmit: () => new Promise(() => {}), // never resolves
    onClose: () => {},
  },
};
```

- [ ] **2.6 Commit**

```bash
git add apps/plugin/src/components/saved-conversations/CollectionFormModal.tsx \
        apps/plugin/src/components/saved-conversations/CollectionFormModal.test.tsx \
        apps/plugin/src/stories/saved-conversations/CollectionFormModal.stories.tsx
git commit -m "feat(plugin): add CollectionFormModal component"
```

---

## Chunk 3: CollectionsSidebar

The left sidebar showing "All saved" + list of collections, with inline rename and delete confirm.

Files:
- Create: `apps/plugin/src/components/saved-conversations/CollectionsSidebar.tsx`
- Create: `apps/plugin/src/components/saved-conversations/CollectionsSidebar.test.tsx`
- Create: `apps/plugin/src/stories/saved-conversations/CollectionsSidebar.stories.tsx`

---

- [ ] **3.1 Write the failing tests**

Create `apps/plugin/src/components/saved-conversations/CollectionsSidebar.test.tsx`:

```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CollectionsSidebar } from './CollectionsSidebar';
import type { Collection } from '../../evaluation/types';

const makeCollection = (id: string, name: string, count = 3): Collection => ({
  tenant_id: 'test',
  collection_id: id,
  name,
  created_by: 'user',
  updated_by: 'user',
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
  member_count: count,
});

describe('CollectionsSidebar', () => {
  const onSelect = jest.fn();
  const onCreateCollection = jest.fn();
  const onRenameCollection = jest.fn();
  const onDeleteCollection = jest.fn();

  const collections: Collection[] = [
    makeCollection('col-1', 'Regression tests', 8),
    makeCollection('col-2', 'Bug reports', 5),
  ];

  beforeEach(() => {
    onSelect.mockReset();
    onCreateCollection.mockReset();
    onRenameCollection.mockReset();
    onDeleteCollection.mockReset();
  });

  it('renders All saved and collection names', () => {
    render(
      <CollectionsSidebar
        collections={collections}
        totalCount={24}
        activeCollectionID={null}
        onSelect={onSelect}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onDeleteCollection={onDeleteCollection}
      />
    );
    expect(screen.getByText('All saved')).toBeInTheDocument();
    expect(screen.getByText('Regression tests')).toBeInTheDocument();
    expect(screen.getByText('Bug reports')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
  });

  it('calls onSelect with null when All saved is clicked', () => {
    render(
      <CollectionsSidebar
        collections={collections}
        totalCount={10}
        activeCollectionID="col-1"
        onSelect={onSelect}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onDeleteCollection={onDeleteCollection}
      />
    );
    fireEvent.click(screen.getByText('All saved'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('calls onSelect with collection_id when a collection is clicked', () => {
    render(
      <CollectionsSidebar
        collections={collections}
        totalCount={10}
        activeCollectionID={null}
        onSelect={onSelect}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onDeleteCollection={onDeleteCollection}
      />
    );
    fireEvent.click(screen.getByText('Regression tests'));
    expect(onSelect).toHaveBeenCalledWith('col-1');
  });

  it('enters inline rename mode and calls onRenameCollection on confirm', async () => {
    onRenameCollection.mockResolvedValue(undefined);
    render(
      <CollectionsSidebar
        collections={collections}
        totalCount={10}
        activeCollectionID={null}
        onSelect={onSelect}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onDeleteCollection={onDeleteCollection}
      />
    );
    // Hover reveals kebab — simulate by finding the menu button directly
    fireEvent.click(screen.getAllByLabelText(/collection options/i)[0]);
    fireEvent.click(screen.getByText(/rename/i));
    const input = screen.getByDisplayValue('Regression tests');
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onRenameCollection).toHaveBeenCalledWith('col-1', 'New name'));
  });

  it('cancels inline rename on Escape', () => {
    render(
      <CollectionsSidebar
        collections={collections}
        totalCount={10}
        activeCollectionID={null}
        onSelect={onSelect}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onDeleteCollection={onDeleteCollection}
      />
    );
    fireEvent.click(screen.getAllByLabelText(/collection options/i)[0]);
    fireEvent.click(screen.getByText(/rename/i));
    const input = screen.getByDisplayValue('Regression tests');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByDisplayValue('Regression tests')).not.toBeInTheDocument();
    expect(screen.getByText('Regression tests')).toBeInTheDocument();
  });

  it('calls onCreateCollection when New collection is clicked', () => {
    render(
      <CollectionsSidebar
        collections={collections}
        totalCount={10}
        activeCollectionID={null}
        onSelect={onSelect}
        onCreateCollection={onCreateCollection}
        onRenameCollection={onRenameCollection}
        onDeleteCollection={onDeleteCollection}
      />
    );
    fireEvent.click(screen.getByText(/new collection/i));
    expect(onCreateCollection).toHaveBeenCalled();
  });
});
```

- [ ] **3.2 Run to confirm failure**

```bash
cd apps/plugin && pnpm exec jest --testPathPattern=CollectionsSidebar --watchAll=false 2>&1 | tail -20
```

Expected: FAIL — `CollectionsSidebar` not found.

- [ ] **3.3 Implement CollectionsSidebar**

Create `apps/plugin/src/components/saved-conversations/CollectionsSidebar.tsx`:

```tsx
import React, { useRef, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, ConfirmModal, Icon, IconButton, Input, useStyles2 } from '@grafana/ui';
import type { Collection } from '../../evaluation/types';

export type CollectionsSidebarProps = {
  collections: Collection[];
  totalCount: number;
  activeCollectionID: string | null;
  onSelect: (id: string | null) => void;
  onCreateCollection: () => void;
  onRenameCollection: (id: string, name: string) => Promise<void>;
  onDeleteCollection: (id: string) => Promise<void>;
};

type MenuState = { collectionID: string; type: 'menu' | 'rename' | 'delete' } | null;

const getStyles = (theme: GrafanaTheme2) => ({
  sidebar: css({
    width: 200,
    flexShrink: 0,
    borderRight: `1px solid ${theme.colors.border.weak}`,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    height: '100%',
  }),
  scrollArea: css({
    flex: 1,
    overflowY: 'auto',
    padding: theme.spacing(1, 1, 0),
  }),
  allSaved: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(0.75, 1),
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    marginBottom: theme.spacing(1),
    '&:hover': { background: theme.colors.action.hover },
  }),
  allSavedActive: css({
    background: `${theme.colors.primary.transparent} !important`,
    border: `1px solid ${theme.colors.primary.border}`,
  }),
  sectionLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.disabled,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: theme.spacing(1, 1, 0.5),
  }),
  collectionItem: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(0.75, 1),
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    '&:hover': { background: theme.colors.action.hover },
    '&:hover [data-kebab]': { visibility: 'visible' },
  }),
  collectionItemActive: css({
    background: `${theme.colors.primary.transparent} !important`,
  }),
  collectionName: css({
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: theme.typography.body.fontSize,
  }),
  count: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    flexShrink: 0,
    marginLeft: theme.spacing(0.5),
  }),
  kebab: css({
    visibility: 'hidden',
    flexShrink: 0,
  }),
  menuPopover: css({
    position: 'absolute',
    right: 0,
    top: '100%',
    zIndex: 100,
    background: theme.colors.background.elevated,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(0.5),
    minWidth: 120,
  }),
  menuItem: css({
    padding: theme.spacing(0.75, 1.5),
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    fontSize: theme.typography.body.fontSize,
    '&:hover': { background: theme.colors.action.hover },
  }),
  menuItemDanger: css({
    color: theme.colors.error.text,
  }),
  renameInput: css({
    flex: 1,
  }),
  footer: css({
    padding: theme.spacing(1),
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
  newCollectionBtn: css({
    width: '100%',
    border: `1px dashed ${theme.colors.primary.border}`,
    background: 'transparent',
    color: theme.colors.primary.text,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(0.75),
    cursor: 'pointer',
    fontSize: theme.typography.body.fontSize,
    '&:hover': { background: theme.colors.primary.transparent },
  }),
});

export function CollectionsSidebar({
  collections,
  totalCount,
  activeCollectionID,
  onSelect,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
}: CollectionsSidebarProps) {
  const styles = useStyles2(getStyles);
  const [menuState, setMenuState] = useState<MenuState>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | undefined>();
  const renameInputRef = useRef<HTMLInputElement>(null);

  const openMenu = (e: React.MouseEvent, collectionID: string) => {
    e.stopPropagation();
    setMenuState({ collectionID, type: 'menu' });
  };

  const startRename = (collection: Collection) => {
    setRenameValue(collection.name);
    setRenameError(undefined);
    setMenuState({ collectionID: collection.collection_id, type: 'rename' });
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const confirmRename = async (collectionID: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError('Name cannot be empty');
      return;
    }
    try {
      await onRenameCollection(collectionID, trimmed);
      setMenuState(null);
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : 'Rename failed');
    }
  };

  const cancelRename = () => {
    setMenuState(null);
    setRenameError(undefined);
  };

  const collectionToDelete = collections.find(
    (c) => menuState?.type === 'delete' && c.collection_id === menuState.collectionID
  );

  return (
    <div className={styles.sidebar}>
      <div className={styles.scrollArea}>
        {/* All saved */}
        <div
          className={`${styles.allSaved} ${activeCollectionID === null ? styles.allSavedActive : ''}`}
          onClick={() => onSelect(null)}
        >
          <span>All saved</span>
          <Badge text={String(totalCount)} color="blue" />
        </div>

        <div className={styles.sectionLabel}>Collections</div>

        {collections.map((col) => {
          const isRenaming = menuState?.type === 'rename' && menuState.collectionID === col.collection_id;
          const isActive = activeCollectionID === col.collection_id;

          return (
            <div
              key={col.collection_id}
              className={`${styles.collectionItem} ${isActive ? styles.collectionItemActive : ''}`}
              style={{ position: 'relative' }}
              onClick={() => !isRenaming && onSelect(col.collection_id)}
            >
              {isRenaming ? (
                <>
                  <Input
                    ref={renameInputRef}
                    className={styles.renameInput}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.currentTarget.value)}
                    invalid={!!renameError}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') confirmRename(col.collection_id);
                      if (e.key === 'Escape') cancelRename();
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <IconButton name="check" tooltip="Confirm rename" onClick={() => confirmRename(col.collection_id)} />
                  <IconButton name="times" tooltip="Cancel rename" onClick={cancelRename} />
                </>
              ) : (
                <>
                  <span className={styles.collectionName}>{col.name}</span>
                  <span className={styles.count}>{col.member_count}</span>
                  <span
                    data-kebab
                    className={styles.kebab}
                  >
                    <IconButton
                      name="ellipsis-v"
                      tooltip="Collection options"
                      aria-label="collection options"
                      size="sm"
                      onClick={(e) => openMenu(e, col.collection_id)}
                    />
                  </span>
                  {menuState?.type === 'menu' && menuState.collectionID === col.collection_id && (
                    <div className={styles.menuPopover}>
                      <div className={styles.menuItem} onClick={(e) => { e.stopPropagation(); startRename(col); }}>
                        Rename
                      </div>
                      <div
                        className={`${styles.menuItem} ${styles.menuItemDanger}`}
                        onClick={(e) => { e.stopPropagation(); setMenuState({ collectionID: col.collection_id, type: 'delete' }); }}
                      >
                        Delete
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.footer}>
        <button className={styles.newCollectionBtn} onClick={onCreateCollection}>
          + New collection
        </button>
      </div>

      {collectionToDelete && (
        <ConfirmModal
          isOpen
          title="Delete collection"
          body={`Delete "${collectionToDelete.name}"? This removes the collection and its ${collectionToDelete.member_count} membership links. The conversations themselves will not be deleted.`}
          confirmText="Delete collection"
          onConfirm={async () => {
            await onDeleteCollection(collectionToDelete.collection_id);
            setMenuState(null);
          }}
          onDismiss={() => setMenuState(null)}
          confirmButtonVariant="destructive"
        />
      )}
    </div>
  );
}
```

- [ ] **3.4 Run tests to confirm pass**

```bash
cd apps/plugin && pnpm exec jest --testPathPattern=CollectionsSidebar --watchAll=false 2>&1 | tail -20
```

Expected: PASS — all tests pass.

- [ ] **3.5 Write Storybook story**

Create `apps/plugin/src/stories/saved-conversations/CollectionsSidebar.stories.tsx`:

```tsx
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CollectionsSidebar } from '../../components/saved-conversations/CollectionsSidebar';
import type { Collection } from '../../evaluation/types';

const makeCollection = (id: string, name: string, count: number): Collection => ({
  tenant_id: 'demo', collection_id: id, name,
  created_by: 'user', updated_by: 'user',
  created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z',
  member_count: count,
});

const collections: Collection[] = [
  makeCollection('col-1', 'Regression tests', 8),
  makeCollection('col-2', 'Bug reports', 5),
  makeCollection('col-3', 'Edge cases', 11),
];

const meta: Meta<typeof CollectionsSidebar> = {
  title: 'SavedConversations/CollectionsSidebar',
  component: CollectionsSidebar,
};
export default meta;
type Story = StoryObj<typeof CollectionsSidebar>;

export const Default: Story = {
  render: () => {
    const [active, setActive] = useState<string | null>(null);
    return (
      <div style={{ height: 400, display: 'flex' }}>
        <CollectionsSidebar
          collections={collections}
          totalCount={24}
          activeCollectionID={active}
          onSelect={setActive}
          onCreateCollection={() => alert('create')}
          onRenameCollection={async (id, name) => console.log('rename', id, name)}
          onDeleteCollection={async (id) => console.log('delete', id)}
        />
      </div>
    );
  },
};

export const Empty: Story = {
  render: () => (
    <div style={{ height: 400, display: 'flex' }}>
      <CollectionsSidebar
        collections={[]}
        totalCount={0}
        activeCollectionID={null}
        onSelect={() => {}}
        onCreateCollection={() => {}}
        onRenameCollection={async () => {}}
        onDeleteCollection={async () => {}}
      />
    </div>
  ),
};
```

- [ ] **3.6 Commit**

```bash
git add apps/plugin/src/components/saved-conversations/CollectionsSidebar.tsx \
        apps/plugin/src/components/saved-conversations/CollectionsSidebar.test.tsx \
        apps/plugin/src/stories/saved-conversations/CollectionsSidebar.stories.tsx
git commit -m "feat(plugin): add CollectionsSidebar component"
```

---

## Chunk 4: SavedConversationsList

The main list area: column headers, checkbox rows, search filter, selection toolbar, pagination.

Files:
- Create: `apps/plugin/src/components/saved-conversations/SavedConversationsList.tsx`
- Create: `apps/plugin/src/components/saved-conversations/SavedConversationsList.test.tsx`
- Create: `apps/plugin/src/stories/saved-conversations/SavedConversationsList.stories.tsx`

---

- [ ] **4.1 Write the failing tests**

Create `apps/plugin/src/components/saved-conversations/SavedConversationsList.test.tsx`:

```tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SavedConversationsList } from './SavedConversationsList';
import type { SavedConversation } from '../../evaluation/types';

const makeSC = (id: string, name: string): SavedConversation => ({
  tenant_id: 'test',
  saved_id: id,
  conversation_id: `conv-${id}`,
  name,
  source: 'telemetry',
  tags: {},
  saved_by: 'alice',
  created_at: '2026-03-10T00:00:00Z',
  updated_at: '2026-03-10T00:00:00Z',
});

describe('SavedConversationsList', () => {
  const onSelectionChange = jest.fn();
  const onAddToCollection = jest.fn();
  const onRemoveFromCollection = jest.fn();
  const onPageChange = jest.fn();

  const conversations = [
    makeSC('s1', 'Auth flow edge case'),
    makeSC('s2', 'Rate limiting test'),
    makeSC('s3', 'Multi-turn hallucination'),
  ];

  const defaultProps = {
    conversations,
    isLoading: false,
    selectedIDs: new Set<string>(),
    onSelectionChange,
    activeCollectionID: null as string | null,
    onAddToCollection,
    onRemoveFromCollection,
    hasNextPage: false,
    onPageChange,
    searchQuery: '',
    onSearchChange: jest.fn(),
  };

  beforeEach(() => {
    onSelectionChange.mockReset();
    onAddToCollection.mockReset();
    onRemoveFromCollection.mockReset();
    onPageChange.mockReset();
  });

  it('renders conversation names', () => {
    render(<SavedConversationsList {...defaultProps} />);
    expect(screen.getByText('Auth flow edge case')).toBeInTheDocument();
    expect(screen.getByText('Rate limiting test')).toBeInTheDocument();
  });

  it('calls onSelectionChange when a checkbox is toggled', () => {
    render(<SavedConversationsList {...defaultProps} />);
    const checkboxes = screen.getAllByRole('checkbox');
    // index 0 is the select-all checkbox
    fireEvent.click(checkboxes[1]);
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['s1']));
  });

  it('shows selection toolbar when items are selected', () => {
    render(
      <SavedConversationsList
        {...defaultProps}
        selectedIDs={new Set(['s1', 's2'])}
      />
    );
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
    expect(screen.getByText(/add to collection/i)).toBeInTheDocument();
  });

  it('hides Remove button when activeCollectionID is null', () => {
    render(
      <SavedConversationsList
        {...defaultProps}
        selectedIDs={new Set(['s1'])}
        activeCollectionID={null}
      />
    );
    expect(screen.queryByText(/^remove$/i)).not.toBeInTheDocument();
  });

  it('shows Remove button when a collection is active', () => {
    render(
      <SavedConversationsList
        {...defaultProps}
        selectedIDs={new Set(['s1'])}
        activeCollectionID="col-1"
      />
    );
    expect(screen.getByText(/^remove$/i)).toBeInTheDocument();
  });

  it('calls onRemoveFromCollection when Remove is clicked', () => {
    render(
      <SavedConversationsList
        {...defaultProps}
        selectedIDs={new Set(['s1', 's2'])}
        activeCollectionID="col-1"
      />
    );
    fireEvent.click(screen.getByText(/^remove$/i));
    expect(onRemoveFromCollection).toHaveBeenCalledWith(new Set(['s1', 's2']));
  });

  it('filters rows by search query', () => {
    render(<SavedConversationsList {...defaultProps} searchQuery="Rate" />);
    expect(screen.getByText('Rate limiting test')).toBeInTheDocument();
    expect(screen.queryByText('Auth flow edge case')).not.toBeInTheDocument();
  });

  it('shows loading spinner when isLoading is true', () => {
    render(<SavedConversationsList {...defaultProps} conversations={[]} isLoading />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('selects all visible rows on select-all click', () => {
    render(<SavedConversationsList {...defaultProps} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['s1', 's2', 's3']));
  });
});
```

- [ ] **4.2 Run to confirm failure**

```bash
cd apps/plugin && pnpm exec jest --testPathPattern=SavedConversationsList --watchAll=false 2>&1 | tail -20
```

Expected: FAIL — `SavedConversationsList` not found.

- [ ] **4.3 Implement SavedConversationsList**

Create `apps/plugin/src/components/saved-conversations/SavedConversationsList.tsx`:

```tsx
import React from 'react';
import { css } from '@emotion/css';
import { dateTime, type GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, Input, Spinner, useStyles2 } from '@grafana/ui';
import { PLUGIN_BASE, buildConversationExploreRoute } from '../../constants';
import type { SavedConversation } from '../../evaluation/types';

export type SavedConversationsListProps = {
  conversations: SavedConversation[];
  isLoading: boolean;
  selectedIDs: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  activeCollectionID: string | null;
  onAddToCollection: () => void;
  onRemoveFromCollection: (ids: Set<string>) => void;
  hasNextPage: boolean;
  onPageChange: (direction: 'next' | 'prev') => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minWidth: 0,
  }),
  toolbar: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 2),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  searchInput: css({
    flex: 1,
  }),
  selectionInfo: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 1.5),
    background: `${theme.colors.primary.transparent}`,
    border: `1px solid ${theme.colors.primary.border}`,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.primary.text,
  }),
  divider: css({
    width: 1,
    height: 14,
    background: theme.colors.primary.border,
  }),
  selectionAction: css({
    cursor: 'pointer',
    fontWeight: theme.typography.fontWeightMedium,
    '&:hover': { textDecoration: 'underline' },
  }),
  removeAction: css({
    cursor: 'pointer',
    color: theme.colors.error.text,
    '&:hover': { textDecoration: 'underline' },
  }),
  colHeaders: css({
    display: 'grid',
    gridTemplateColumns: '32px 1fr 140px 120px',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 2),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  }),
  rows: css({
    flex: 1,
    overflowY: 'auto',
  }),
  row: css({
    display: 'grid',
    gridTemplateColumns: '32px 1fr 140px 120px',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 2),
    alignItems: 'center',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    '&:hover': { background: theme.colors.action.hover },
  }),
  rowSelected: css({
    background: `${theme.colors.primary.transparent} !important`,
    borderLeft: `2px solid ${theme.colors.primary.main}`,
    paddingLeft: `calc(${theme.spacing(2)} - 2px)`,
  }),
  conversationName: css({
    cursor: 'pointer',
    color: theme.colors.text.link,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    '&:hover': { textDecoration: 'underline' },
  }),
  secondary: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.body.fontSize,
  }),
  emptyState: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: theme.spacing(1),
    color: theme.colors.text.secondary,
    padding: theme.spacing(6),
  }),
  spinnerContainer: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  }),
  pagination: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing(1, 2),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
});

export function SavedConversationsList({
  conversations,
  isLoading,
  selectedIDs,
  onSelectionChange,
  activeCollectionID,
  onAddToCollection,
  onRemoveFromCollection,
  hasNextPage,
  onPageChange,
  searchQuery,
  onSearchChange,
}: SavedConversationsListProps) {
  const styles = useStyles2(getStyles);

  const filtered = searchQuery
    ? conversations.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : conversations;

  const allSelected = filtered.length > 0 && filtered.every((c) => selectedIDs.has(c.saved_id));

  const toggleSelectAll = () => {
    if (allSelected) {
      const next = new Set(selectedIDs);
      filtered.forEach((c) => next.delete(c.saved_id));
      onSelectionChange(next);
    } else {
      const next = new Set(selectedIDs);
      filtered.forEach((c) => next.add(c.saved_id));
      onSelectionChange(next);
    }
  };

  const toggleRow = (id: string) => {
    const next = new Set(selectedIDs);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelectionChange(next);
  };

  const hasSelection = selectedIDs.size > 0;

  return (
    <div className={styles.container}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        {hasSelection ? (
          <div className={styles.selectionInfo}>
            <span>{selectedIDs.size} selected</span>
            <span className={styles.divider} />
            <span className={styles.selectionAction} onClick={onAddToCollection}>
              Add to collection ›
            </span>
            {activeCollectionID !== null && (
              <>
                <span className={styles.divider} />
                <span className={styles.removeAction} onClick={() => onRemoveFromCollection(selectedIDs)}>
                  Remove
                </span>
              </>
            )}
          </div>
        ) : (
          <Input
            className={styles.searchInput}
            prefix={<Icon name="search" />}
            placeholder="Search saved conversations..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.currentTarget.value)}
          />
        )}
      </div>

      {/* Column headers */}
      <div className={styles.colHeaders}>
        <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
        <span>Name</span>
        <span>Saved by</span>
        <span>Date</span>
      </div>

      {/* Rows */}
      {isLoading ? (
        <div className={styles.spinnerContainer} data-testid="loading-spinner">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <Icon name="folder-open" size="xxl" />
          <span>{searchQuery ? 'No conversations match your search' : 'No saved conversations yet'}</span>
        </div>
      ) : (
        <div className={styles.rows}>
          {filtered.map((sc) => (
            <div
              key={sc.saved_id}
              className={`${styles.row} ${selectedIDs.has(sc.saved_id) ? styles.rowSelected : ''}`}
            >
              <input
                type="checkbox"
                checked={selectedIDs.has(sc.saved_id)}
                onChange={() => toggleRow(sc.saved_id)}
              />
              <span
                className={styles.conversationName}
                onClick={() => window.open(`${PLUGIN_BASE}/${buildConversationExploreRoute(sc.conversation_id)}`, '_blank')}
              >
                {sc.name}
              </span>
              <span className={styles.secondary}>{sc.saved_by || '—'}</span>
              <span className={styles.secondary}>{dateTime(sc.created_at).format('MMM D, YYYY')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className={styles.pagination}>
        <span>{conversations.length} conversation{conversations.length !== 1 ? 's' : ''}</span>
        {hasNextPage && (
          <Button variant="secondary" size="sm" onClick={() => onPageChange('next')}>
            Next →
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **4.4 Run tests to confirm pass**

```bash
cd apps/plugin && pnpm exec jest --testPathPattern=SavedConversationsList --watchAll=false 2>&1 | tail -20
```

Expected: PASS.

- [ ] **4.5 Write Storybook story**

Create `apps/plugin/src/stories/saved-conversations/SavedConversationsList.stories.tsx`:

```tsx
import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { SavedConversationsList } from '../../components/saved-conversations/SavedConversationsList';
import type { SavedConversation } from '../../evaluation/types';

const makeSC = (id: string, name: string): SavedConversation => ({
  tenant_id: 'demo', saved_id: id, conversation_id: `conv-${id}`,
  name, source: 'telemetry', tags: {}, saved_by: 'alice',
  created_at: '2026-03-10T00:00:00Z', updated_at: '2026-03-10T00:00:00Z',
});

const conversations = [
  makeSC('s1', 'Auth flow edge case'),
  makeSC('s2', 'Rate limiting test'),
  makeSC('s3', 'Multi-turn hallucination'),
];

const meta: Meta<typeof SavedConversationsList> = {
  title: 'SavedConversations/SavedConversationsList',
  component: SavedConversationsList,
};
export default meta;
type Story = StoryObj<typeof SavedConversationsList>;

export const Default: Story = {
  render: () => {
    const [selected, setSelected] = useState(new Set<string>());
    const [query, setQuery] = useState('');
    return (
      <div style={{ height: 500, display: 'flex', flexDirection: 'column' }}>
        <SavedConversationsList
          conversations={conversations}
          isLoading={false}
          selectedIDs={selected}
          onSelectionChange={setSelected}
          activeCollectionID={null}
          onAddToCollection={() => alert('add to collection')}
          onRemoveFromCollection={() => {}}
          hasNextPage={false}
          onPageChange={() => {}}
          searchQuery={query}
          onSearchChange={setQuery}
        />
      </div>
    );
  },
};

export const WithActiveCollection: Story = {
  render: () => {
    const [selected, setSelected] = useState(new Set<string>(['s1']));
    return (
      <div style={{ height: 500, display: 'flex', flexDirection: 'column' }}>
        <SavedConversationsList
          conversations={conversations}
          isLoading={false}
          selectedIDs={selected}
          onSelectionChange={setSelected}
          activeCollectionID="col-1"
          onAddToCollection={() => {}}
          onRemoveFromCollection={(ids) => alert(`remove: ${[...ids].join(', ')}`)}
          hasNextPage
          onPageChange={() => {}}
          searchQuery=""
          onSearchChange={() => {}}
        />
      </div>
    );
  },
};

export const Loading: Story = {
  args: {
    conversations: [],
    isLoading: true,
    selectedIDs: new Set(),
    onSelectionChange: () => {},
    activeCollectionID: null,
    onAddToCollection: () => {},
    onRemoveFromCollection: () => {},
    hasNextPage: false,
    onPageChange: () => {},
    searchQuery: '',
    onSearchChange: () => {},
  },
};

export const Empty: Story = {
  args: {
    ...Loading.args,
    isLoading: false,
  },
};
```

- [ ] **4.6 Commit**

```bash
git add apps/plugin/src/components/saved-conversations/SavedConversationsList.tsx \
        apps/plugin/src/components/saved-conversations/SavedConversationsList.test.tsx \
        apps/plugin/src/stories/saved-conversations/SavedConversationsList.stories.tsx
git commit -m "feat(plugin): add SavedConversationsList component"
```

---

## Chunk 5: AddToCollectionModal

The multi-select checklist for assigning conversations to collections.

Files:
- Create: `apps/plugin/src/components/saved-conversations/AddToCollectionModal.tsx`
- Create: `apps/plugin/src/components/saved-conversations/AddToCollectionModal.test.tsx`
- Create: `apps/plugin/src/stories/saved-conversations/AddToCollectionModal.stories.tsx`

---

- [ ] **5.1 Write the failing tests**

Create `apps/plugin/src/components/saved-conversations/AddToCollectionModal.test.tsx`:

```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddToCollectionModal } from './AddToCollectionModal';
import type { Collection } from '../../evaluation/types';
import type { EvaluationDataSource } from '../../evaluation/api';

const makeCollection = (id: string, name: string): Collection => ({
  tenant_id: 'test', collection_id: id, name,
  created_by: 'user', updated_by: 'user',
  created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z',
  member_count: 2,
});

const collections: Collection[] = [
  makeCollection('col-1', 'Regression tests'),
  makeCollection('col-2', 'Bug reports'),
];

function buildDataSource(memberMap: Record<string, string[]>): Pick<EvaluationDataSource,
  'listCollectionsForSavedConversation' | 'addCollectionMembers' | 'removeCollectionMember' | 'createCollection'
> {
  return {
    listCollectionsForSavedConversation: jest.fn(async (savedID: string) => ({
      items: collections.filter((c) => memberMap[savedID]?.includes(c.collection_id)),
      next_cursor: '',
    })),
    addCollectionMembers: jest.fn(async () => {}),
    removeCollectionMember: jest.fn(async () => {}),
    createCollection: jest.fn(async () => collections[0]),
  };
}

describe('AddToCollectionModal', () => {
  const onClose = jest.fn();
  const onSaved = jest.fn();

  beforeEach(() => {
    onClose.mockReset();
    onSaved.mockReset();
  });

  it('shows all collections as checkboxes', async () => {
    const ds = buildDataSource({});
    render(
      <AddToCollectionModal
        isOpen
        selectedSavedIDs={['s1']}
        collections={collections}
        dataSource={ds as unknown as EvaluationDataSource}
        onClose={onClose}
        onSaved={onSaved}
        onCollectionCreated={jest.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Regression tests')).toBeInTheDocument();
      expect(screen.getByLabelText('Bug reports')).toBeInTheDocument();
    });
  });

  it('pre-checks collections where all selected items are members', async () => {
    // s1 is already in col-1
    const ds = buildDataSource({ s1: ['col-1'] });
    render(
      <AddToCollectionModal
        isOpen
        selectedSavedIDs={['s1']}
        collections={collections}
        dataSource={ds as unknown as EvaluationDataSource}
        onClose={onClose}
        onSaved={onSaved}
        onCollectionCreated={jest.fn()}
      />
    );
    await waitFor(() => {
      expect((screen.getByLabelText('Regression tests') as HTMLInputElement).checked).toBe(true);
      expect((screen.getByLabelText('Bug reports') as HTMLInputElement).checked).toBe(false);
    });
  });

  it('calls addCollectionMembers on Save for newly checked collections', async () => {
    const ds = buildDataSource({});
    render(
      <AddToCollectionModal
        isOpen
        selectedSavedIDs={['s1', 's2']}
        collections={collections}
        dataSource={ds as unknown as EvaluationDataSource}
        onClose={onClose}
        onSaved={onSaved}
        onCollectionCreated={jest.fn()}
      />
    );
    await waitFor(() => screen.getByLabelText('Regression tests'));
    fireEvent.click(screen.getByLabelText('Regression tests'));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(ds.addCollectionMembers).toHaveBeenCalledWith('col-1', {
        saved_ids: ['s1', 's2'],
        added_by: 'user',
      })
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it('calls onClose on Cancel', async () => {
    const ds = buildDataSource({});
    render(
      <AddToCollectionModal
        isOpen
        selectedSavedIDs={['s1']}
        collections={collections}
        dataSource={ds as unknown as EvaluationDataSource}
        onClose={onClose}
        onSaved={onSaved}
        onCollectionCreated={jest.fn()}
      />
    );
    await waitFor(() => screen.getByLabelText('Regression tests'));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **5.2 Run to confirm failure**

```bash
cd apps/plugin && pnpm exec jest --testPathPattern=AddToCollectionModal --watchAll=false 2>&1 | tail -20
```

Expected: FAIL — `AddToCollectionModal` not found.

- [ ] **5.3 Implement AddToCollectionModal**

Create `apps/plugin/src/components/saved-conversations/AddToCollectionModal.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, Button, Input, Modal, useStyles2 } from '@grafana/ui';
import type { EvaluationDataSource } from '../../evaluation/api';
import type { Collection } from '../../evaluation/types';
import { CollectionFormModal } from './CollectionFormModal';

export type AddToCollectionModalProps = {
  isOpen: boolean;
  selectedSavedIDs: string[];
  collections: Collection[];
  dataSource: Pick<EvaluationDataSource,
    'listCollectionsForSavedConversation' | 'addCollectionMembers' | 'removeCollectionMember' | 'createCollection'
  >;
  onClose: () => void;
  onSaved: () => void;
  onCollectionCreated: (collection: Collection) => void;
};

// checked = all selected in collection, partial = some, unchecked = none
type CheckState = 'checked' | 'partial' | 'unchecked';

const getStyles = (theme: GrafanaTheme2) => ({
  body: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
  }),
  subtitle: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    marginTop: theme.spacing(-1),
  }),
  filterInput: css({ width: '100%' }),
  list: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    maxHeight: 280,
    overflowY: 'auto',
  }),
  item: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 1),
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    '&:hover': { background: theme.colors.action.hover },
  }),
  itemLabel: css({ flex: 1, fontSize: theme.typography.body.fontSize }),
  itemCount: css({ fontSize: theme.typography.bodySmall.fontSize, color: theme.colors.text.secondary }),
  partialNote: css({ fontSize: theme.typography.bodySmall.fontSize, color: theme.colors.text.secondary, fontStyle: 'italic' }),
  createLink: css({
    borderTop: `1px solid ${theme.colors.border.weak}`,
    paddingTop: theme.spacing(1),
    color: theme.colors.primary.text,
    cursor: 'pointer',
    fontSize: theme.typography.body.fontSize,
    '&:hover': { textDecoration: 'underline' },
  }),
  footer: css({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    marginTop: theme.spacing(0.5),
  }),
});

export function AddToCollectionModal({
  isOpen,
  selectedSavedIDs,
  collections,
  dataSource,
  onClose,
  onSaved,
  onCollectionCreated,
}: AddToCollectionModalProps) {
  const styles = useStyles2(getStyles);

  // Map: collectionID -> Set of selectedSavedIDs already in it
  const [membershipMap, setMembershipMap] = useState<Map<string, Set<string>>>(new Map());
  const [checkStates, setCheckStates] = useState<Map<string, CheckState>>(new Map());
  const [filterQuery, setFilterQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Load membership on open
  useEffect(() => {
    if (!isOpen || selectedSavedIDs.length === 0) return;

    const BATCH = 20;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(undefined);
      const result = new Map<string, Set<string>>();
      collections.forEach((c) => result.set(c.collection_id, new Set()));

      try {
        for (let i = 0; i < selectedSavedIDs.length; i += BATCH) {
          if (cancelled) return;
          const batch = selectedSavedIDs.slice(i, i + BATCH);
          // Note: listCollectionsForSavedConversation has no cursor parameter in the
          // current API, so only the first page of memberships is fetched per conversation.
          // This is a known API limitation — memberships beyond the first page will not
          // be reflected in the checkbox state.
          const responses = await Promise.all(
            batch.map((id) => dataSource.listCollectionsForSavedConversation(id))
          );
          responses.forEach((resp, idx) => {
            const savedID = batch[idx];
            resp.items.forEach((col) => {
              result.get(col.collection_id)?.add(savedID);
            });
          });
        }
        if (cancelled) return;

        setMembershipMap(result);
        const states = new Map<string, CheckState>();
        result.forEach((members, colID) => {
          if (members.size === 0) states.set(colID, 'unchecked');
          else if (members.size === selectedSavedIDs.length) states.set(colID, 'checked');
          else states.set(colID, 'partial');
        });
        setCheckStates(states);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load memberships');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [isOpen, selectedSavedIDs, collections, dataSource]);

  const toggleCheck = (colID: string) => {
    setCheckStates((prev) => {
      const next = new Map(prev);
      const cur = prev.get(colID) ?? 'unchecked';
      next.set(colID, cur === 'checked' ? 'unchecked' : 'checked');
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(undefined);
    try {
      for (const col of collections) {
        const current = membershipMap.get(col.collection_id) ?? new Set<string>();
        const state = checkStates.get(col.collection_id) ?? 'unchecked';

        if (state === 'checked') {
          // Add conversations not already in this collection
          const toAdd = selectedSavedIDs.filter((id) => !current.has(id));
          if (toAdd.length > 0) {
            await dataSource.addCollectionMembers(col.collection_id, { saved_ids: toAdd, added_by: 'user' });
          }
        } else if (state === 'unchecked') {
          // Remove conversations that were in this collection
          const toRemove = selectedSavedIDs.filter((id) => current.has(id));
          await Promise.all(
            toRemove.map((id) => dataSource.removeCollectionMember(col.collection_id, id))
          );
        }
        // partial -> partial: no-op (user didn't change it)
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCollection = async (values: { name: string; description?: string }) => {
    const created = await dataSource.createCollection({
      name: values.name,
      description: values.description,
      created_by: 'user',
    });
    onCollectionCreated(created);
    setShowCreateModal(false);
    // Pre-check the newly created collection
    setCheckStates((prev) => new Map(prev).set(created.collection_id, 'checked'));
    setMembershipMap((prev) => new Map(prev).set(created.collection_id, new Set()));
  };

  const filtered = filterQuery
    ? collections.filter((c) => c.name.toLowerCase().includes(filterQuery.toLowerCase()))
    : collections;

  return (
    <>
      <Modal title="Add to collection" isOpen={isOpen} onDismiss={onClose}>
        <div className={styles.body}>
          <div className={styles.subtitle}>
            {selectedSavedIDs.length} conversation{selectedSavedIDs.length !== 1 ? 's' : ''} selected
          </div>
          {error && <Alert title={error} severity="error" />}
          <Input
            className={styles.filterInput}
            placeholder="Filter collections..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.currentTarget.value)}
          />
          <div className={styles.list}>
            {loading ? (
              <span style={{ padding: '8px', color: 'var(--color-text-secondary)' }}>Loading...</span>
            ) : (
              filtered.map((col) => {
                const state = checkStates.get(col.collection_id) ?? 'unchecked';
                const isChecked = state === 'checked';
                const isPartial = state === 'partial';
                return (
                  <div key={col.collection_id} className={styles.item} onClick={() => toggleCheck(col.collection_id)}>
                    <input
                      type="checkbox"
                      aria-label={col.name}
                      checked={isChecked}
                      ref={(el) => { if (el) el.indeterminate = isPartial; }}
                      onChange={() => toggleCheck(col.collection_id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className={styles.itemLabel}>{col.name}</span>
                    <span className={styles.itemCount}>{col.member_count}</span>
                    {isPartial && <span className={styles.partialNote}>partial</span>}
                  </div>
                );
              })
            )}
          </div>
          <div className={styles.createLink} onClick={() => setShowCreateModal(true)}>
            + Create new collection
          </div>
          <div className={styles.footer}>
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
      <CollectionFormModal
        isOpen={showCreateModal}
        onSubmit={handleCreateCollection}
        onClose={() => setShowCreateModal(false)}
      />
    </>
  );
}
```

- [ ] **5.4 Run tests to confirm pass**

```bash
cd apps/plugin && pnpm exec jest --testPathPattern=AddToCollectionModal --watchAll=false 2>&1 | tail -20
```

Expected: PASS.

- [ ] **5.5 Write Storybook story**

Create `apps/plugin/src/stories/saved-conversations/AddToCollectionModal.stories.tsx`:

```tsx
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { AddToCollectionModal } from '../../components/saved-conversations/AddToCollectionModal';
import type { Collection } from '../../evaluation/types';

const makeCollection = (id: string, name: string, count: number): Collection => ({
  tenant_id: 'demo', collection_id: id, name,
  created_by: 'user', updated_by: 'user',
  created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z',
  member_count: count,
});

const collections: Collection[] = [
  makeCollection('col-1', 'Regression tests', 8),
  makeCollection('col-2', 'Bug reports', 5),
  makeCollection('col-3', 'Edge cases', 11),
];

const dataSource = {
  listCollectionsForSavedConversation: async (id: string) => ({
    items: id === 's1' ? [collections[0]] : [],
    next_cursor: '',
  }),
  addCollectionMembers: async () => {},
  removeCollectionMember: async () => {},
  createCollection: async (req: { name: string; description?: string; created_by: string }) =>
    makeCollection(`col-new-${Date.now()}`, req.name, 0),
};

const meta: Meta<typeof AddToCollectionModal> = {
  title: 'SavedConversations/AddToCollectionModal',
  component: AddToCollectionModal,
};
export default meta;
type Story = StoryObj<typeof AddToCollectionModal>;

export const SingleSelection: Story = {
  args: {
    isOpen: true,
    selectedSavedIDs: ['s1'],
    collections,
    dataSource: dataSource as never,
    onClose: () => {},
    onSaved: () => {},
    onCollectionCreated: () => {},
  },
};

export const MultipleSelections: Story = {
  args: {
    ...SingleSelection.args,
    selectedSavedIDs: ['s1', 's2', 's3'],
  },
};
```

- [ ] **5.6 Commit**

```bash
git add apps/plugin/src/components/saved-conversations/AddToCollectionModal.tsx \
        apps/plugin/src/components/saved-conversations/AddToCollectionModal.test.tsx \
        apps/plugin/src/stories/saved-conversations/AddToCollectionModal.stories.tsx
git commit -m "feat(plugin): add AddToCollectionModal component"
```

---

## Chunk 6: SavedConversationsPage

The page root — wires all components together, manages page-level state, fetches data.

Files:
- Create: `apps/plugin/src/pages/SavedConversationsPage.tsx`
- Create: `apps/plugin/src/pages/SavedConversationsPage.test.tsx`
- Create: `apps/plugin/src/stories/saved-conversations/SavedConversationsPage.stories.tsx`

---

- [ ] **6.1 Write the failing tests**

Create `apps/plugin/src/pages/SavedConversationsPage.test.tsx`:

```tsx
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SavedConversationsPage from './SavedConversationsPage';
import type { EvaluationDataSource } from '../evaluation/api';
import type { Collection, SavedConversation, CollectionListResponse, SavedConversationListResponse, CollectionMembersResponse } from '../evaluation/types';

const makeSC = (id: string, name: string): SavedConversation => ({
  tenant_id: 'test', saved_id: id, conversation_id: `conv-${id}`,
  name, source: 'telemetry', tags: {}, saved_by: 'alice',
  created_at: '2026-03-10T00:00:00Z', updated_at: '2026-03-10T00:00:00Z',
});

const makeCollection = (id: string, name: string): Collection => ({
  tenant_id: 'test', collection_id: id, name,
  created_by: 'user', updated_by: 'user',
  created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z',
  member_count: 2,
});

function buildDataSource(overrides?: Partial<EvaluationDataSource>): EvaluationDataSource {
  const base: Partial<EvaluationDataSource> = {
    listCollections: jest.fn(async (): Promise<CollectionListResponse> => ({
      items: [makeCollection('col-1', 'Regression tests')],
      next_cursor: '',
    })),
    listSavedConversations: jest.fn(async (): Promise<SavedConversationListResponse> => ({
      items: [makeSC('s1', 'Auth flow edge case'), makeSC('s2', 'Rate limiting test')],
      next_cursor: '',
    })),
    listCollectionMembers: jest.fn(async (): Promise<CollectionMembersResponse> => ({
      items: [makeSC('s1', 'Auth flow edge case')],
      next_cursor: '',
    })),
    listCollectionsForSavedConversation: jest.fn(async () => ({ items: [], next_cursor: '' })),
    createCollection: jest.fn(async (req) => makeCollection('col-new', req.name)),
    updateCollection: jest.fn(async (_, req) => makeCollection('col-1', req.name ?? 'Updated')),
    deleteCollection: jest.fn(async () => {}),
    addCollectionMembers: jest.fn(async () => {}),
    removeCollectionMember: jest.fn(async () => {}),
  };
  return { ...base, ...overrides } as EvaluationDataSource;
}

describe('SavedConversationsPage', () => {
  it('loads and shows conversations and collections', async () => {
    const ds = buildDataSource();
    render(
      <MemoryRouter>
        <SavedConversationsPage dataSource={ds} />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText('Auth flow edge case')).toBeInTheDocument();
      expect(screen.getByText('Regression tests')).toBeInTheDocument();
    });
  });

  it('filters conversations when a collection is selected', async () => {
    const ds = buildDataSource();
    render(
      <MemoryRouter>
        <SavedConversationsPage dataSource={ds} />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText('Regression tests'));
    fireEvent.click(screen.getByText('Regression tests'));
    await waitFor(() => {
      expect(ds.listCollectionMembers).toHaveBeenCalledWith('col-1', undefined, undefined);
    });
  });

  it('shows error alert when listSavedConversations fails', async () => {
    const ds = buildDataSource({
      listSavedConversations: jest.fn(async () => { throw new Error('network error'); }),
    });
    render(
      <MemoryRouter>
        <SavedConversationsPage dataSource={ds} />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
```

- [ ] **6.2 Run to confirm failure**

```bash
cd apps/plugin && pnpm exec jest --testPathPattern=SavedConversationsPage --watchAll=false 2>&1 | tail -20
```

Expected: FAIL — `SavedConversationsPage` not found.

- [ ] **6.3 Implement SavedConversationsPage**

Create `apps/plugin/src/pages/SavedConversationsPage.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Alert, useStyles2 } from '@grafana/ui';
import { defaultEvaluationDataSource, type EvaluationDataSource } from '../evaluation/api';
import type { Collection, SavedConversation } from '../evaluation/types';
import { CollectionsSidebar } from '../components/saved-conversations/CollectionsSidebar';
import { SavedConversationsList } from '../components/saved-conversations/SavedConversationsList';
import { AddToCollectionModal } from '../components/saved-conversations/AddToCollectionModal';
import { CollectionFormModal } from '../components/saved-conversations/CollectionFormModal';

export type SavedConversationsPageProps = {
  dataSource?: EvaluationDataSource;
};

const getStyles = (theme: GrafanaTheme2) => ({
  page: css({
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  }),
  header: css({
    padding: theme.spacing(2, 3, 1.5),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    flexShrink: 0,
  }),
  title: css({
    fontSize: theme.typography.h3.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    margin: 0,
  }),
  subtitle: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing(0.25),
  }),
  body: css({
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  }),
  errorBar: css({
    margin: theme.spacing(1, 2),
  }),
});

export default function SavedConversationsPage({ dataSource = defaultEvaluationDataSource }: SavedConversationsPageProps) {
  const styles = useStyles2(getStyles);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollectionID, setActiveCollectionID] = useState<string | null>(null);
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [selectedIDs, setSelectedIDs] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Load all collections on mount
  useEffect(() => {
    // Fetch one page of up to 200 collections (spec: truncate silently at 200)
    dataSource.listCollections(200)
      .then((resp) => setCollections(resp.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load collections'));
  }, [dataSource]);

  // Load conversations whenever active collection changes
  const loadConversations = useCallback(async (cursor?: string) => {
    setIsLoading(true);
    setError(undefined);
    try {
      if (activeCollectionID === null) {
        const resp = await dataSource.listSavedConversations(undefined, 50, cursor);
        setConversations(resp.items);
        setNextCursor(resp.next_cursor || undefined);
        setTotalCount(resp.items.length); // approximate; replace with total when API exposes it
      } else {
        const resp = await dataSource.listCollectionMembers(activeCollectionID, undefined, cursor);
        setConversations(resp.items);
        setNextCursor(resp.next_cursor || undefined);
        setTotalCount(resp.items.length);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load conversations');
    } finally {
      setIsLoading(false);
    }
  }, [dataSource, activeCollectionID]);

  useEffect(() => {
    setSelectedIDs(new Set());
    setSearchQuery('');
    setNextCursor(undefined);
    loadConversations();
  }, [loadConversations]);

  const handleSelectCollection = (id: string | null) => {
    setActiveCollectionID(id);
  };

  const handleCreateCollection = async (values: { name: string; description?: string }) => {
    const created = await dataSource.createCollection({ name: values.name, description: values.description, created_by: 'user' });
    setCollections((prev) => [...prev, created]);
    setActiveCollectionID(created.collection_id);
    setShowCreateModal(false);
  };

  const handleRenameCollection = async (id: string, name: string) => {
    const updated = await dataSource.updateCollection(id, { name, updated_by: 'user' });
    setCollections((prev) => prev.map((c) => c.collection_id === id ? { ...c, name: updated.name } : c));
  };

  const handleDeleteCollection = async (id: string) => {
    await dataSource.deleteCollection(id);
    setCollections((prev) => prev.filter((c) => c.collection_id !== id));
    if (activeCollectionID === id) {
      setActiveCollectionID(null);
    }
  };

  const handleRemoveFromCollection = async (ids: Set<string>) => {
    if (!activeCollectionID) return;
    setError(undefined);
    try {
      await Promise.all([...ids].map((id) => dataSource.removeCollectionMember(activeCollectionID, id)));
      setSelectedIDs(new Set());
      await loadConversations();
      // Update member count in sidebar
      setCollections((prev) =>
        prev.map((c) => c.collection_id === activeCollectionID
          ? { ...c, member_count: Math.max(0, c.member_count - ids.size) }
          : c
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove conversations');
    }
  };

  const handleSavedToCollection = async () => {
    setShowAddModal(false);
    setSelectedIDs(new Set());
    // Refresh collections to update member counts
    // Fetch one page of up to 200 collections (spec: truncate silently at 200)
    dataSource.listCollections(200)
      .then((resp) => setCollections(resp.items))
      .catch(() => {});
    await loadConversations();
  };

  const handleCollectionCreatedFromDialog = (collection: Collection) => {
    setCollections((prev) => [...prev, collection]);
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Saved Conversations</h1>
        <p className={styles.subtitle}>Organize and browse your saved conversations</p>
      </div>
      {error && (
        <div className={styles.errorBar}>
          <Alert title={error} severity="error" onRemove={() => setError(undefined)} />
        </div>
      )}
      <div className={styles.body}>
        <CollectionsSidebar
          collections={collections}
          totalCount={totalCount}
          activeCollectionID={activeCollectionID}
          onSelect={handleSelectCollection}
          onCreateCollection={() => setShowCreateModal(true)}
          onRenameCollection={handleRenameCollection}
          onDeleteCollection={handleDeleteCollection}
        />
        <SavedConversationsList
          conversations={conversations}
          isLoading={isLoading}
          selectedIDs={selectedIDs}
          onSelectionChange={setSelectedIDs}
          activeCollectionID={activeCollectionID}
          onAddToCollection={() => setShowAddModal(true)}
          onRemoveFromCollection={handleRemoveFromCollection}
          hasNextPage={!!nextCursor}
          onPageChange={(dir) => dir === 'next' && loadConversations(nextCursor)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </div>
      <AddToCollectionModal
        isOpen={showAddModal}
        selectedSavedIDs={[...selectedIDs]}
        collections={collections}
        dataSource={dataSource}
        onClose={() => setShowAddModal(false)}
        onSaved={handleSavedToCollection}
        onCollectionCreated={handleCollectionCreatedFromDialog}
      />
      <CollectionFormModal
        isOpen={showCreateModal}
        onSubmit={handleCreateCollection}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  );
}
```

- [ ] **6.4 Run tests to confirm pass**

```bash
cd apps/plugin && pnpm exec jest --testPathPattern=SavedConversationsPage --watchAll=false 2>&1 | tail -20
```

Expected: PASS.

- [ ] **6.5 Run full plugin test suite**

```bash
cd apps/plugin && pnpm run test:ci 2>&1 | tail -30
```

Expected: All existing tests still pass.

- [ ] **6.6 Write Storybook story**

Create `apps/plugin/src/stories/saved-conversations/SavedConversationsPage.stories.tsx`:

```tsx
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { MemoryRouter } from 'react-router-dom';
import SavedConversationsPage from '../../pages/SavedConversationsPage';
import type { EvaluationDataSource } from '../../evaluation/api';
import type { Collection, SavedConversation } from '../../evaluation/types';

const makeSC = (id: string, name: string, by = 'alice'): SavedConversation => ({
  tenant_id: 'demo', saved_id: id, conversation_id: `conv-${id}`,
  name, source: 'telemetry', tags: {}, saved_by: by,
  created_at: '2026-03-10T00:00:00Z', updated_at: '2026-03-10T00:00:00Z',
});

const makeCollection = (id: string, name: string, count: number): Collection => ({
  tenant_id: 'demo', collection_id: id, name,
  created_by: 'user', updated_by: 'user',
  created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z',
  member_count: count,
});

const collections: Collection[] = [
  makeCollection('col-1', 'Regression tests', 8),
  makeCollection('col-2', 'Bug reports', 5),
  makeCollection('col-3', 'Edge cases', 11),
];

const conversations: SavedConversation[] = [
  makeSC('s1', 'Auth flow edge case'),
  makeSC('s2', 'Rate limiting test', 'bob'),
  makeSC('s3', 'Multi-turn hallucination'),
  makeSC('s4', 'Tool use timeout', 'carol'),
  makeSC('s5', 'Streaming token drop', 'bob'),
];

const dataSource: Partial<EvaluationDataSource> = {
  listCollections: async () => ({ items: collections, next_cursor: '' }),
  listSavedConversations: async () => ({ items: conversations, next_cursor: '' }),
  listCollectionMembers: async (id) => ({
    items: id === 'col-1' ? conversations.slice(0, 2) : conversations.slice(0, 1),
    next_cursor: '',
  }),
  listCollectionsForSavedConversation: async () => ({ items: [], next_cursor: '' }),
  createCollection: async (req) => makeCollection(`col-${Date.now()}`, req.name, 0),
  updateCollection: async (id, req) => ({ ...collections[0], collection_id: id, name: req.name ?? '' }),
  deleteCollection: async () => {},
  addCollectionMembers: async () => {},
  removeCollectionMember: async () => {},
};

const meta: Meta<typeof SavedConversationsPage> = {
  title: 'SavedConversations/SavedConversationsPage',
  component: SavedConversationsPage,
  decorators: [(Story) => <MemoryRouter><Story /></MemoryRouter>],
};
export default meta;
type Story = StoryObj<typeof SavedConversationsPage>;

export const Default: Story = {
  args: { dataSource: dataSource as EvaluationDataSource },
};

export const Empty: Story = {
  args: {
    dataSource: {
      ...dataSource,
      listCollections: async () => ({ items: [], next_cursor: '' }),
      listSavedConversations: async () => ({ items: [], next_cursor: '' }),
    } as EvaluationDataSource,
  },
};
```

- [ ] **6.7 Run lint and typecheck**

```bash
cd apps/plugin && pnpm run lint && pnpm run typecheck 2>&1 | tail -30
```

Expected: No errors.

- [ ] **6.8 Commit**

```bash
git add apps/plugin/src/pages/SavedConversationsPage.tsx \
        apps/plugin/src/pages/SavedConversationsPage.test.tsx \
        apps/plugin/src/stories/saved-conversations/SavedConversationsPage.stories.tsx
git commit -m "feat(plugin): add SavedConversationsPage — saved conversations collections UI"
```

---

## Final Verification

- [ ] **Navigate to http://localhost:3000/a/grafana-sigil-app/conversations/saved** in a browser (stack must be running via `mise run up`)
- [ ] Verify the page loads with sidebar and conversation list
- [ ] Verify clicking a collection filters the list
- [ ] Verify creating a collection via "+ New collection" works
- [ ] Verify renaming a collection inline works
- [ ] Verify deleting a collection with confirm works
- [ ] Verify multi-select + "Add to collection" dialog with checkbox states works
- [ ] Verify "Remove" removes conversations from the active collection
- [ ] Verify clicking a conversation name opens it in a new tab
