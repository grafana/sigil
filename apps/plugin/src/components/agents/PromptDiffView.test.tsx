import React from 'react';
import { render, screen } from '@testing-library/react';
import { PromptDiffView, computeDiffLines } from './PromptDiffView';

describe('computeDiffLines', () => {
  it('returns all equal lines for identical text', () => {
    const lines = computeDiffLines('a\nb\nc', 'a\nb\nc');
    expect(lines).toEqual([
      { type: 'equal', text: 'a' },
      { type: 'equal', text: 'b' },
      { type: 'equal', text: 'c' },
    ]);
  });

  it('detects added lines', () => {
    const lines = computeDiffLines('a\nc', 'a\nb\nc');
    const added = lines.filter((l) => l.type === 'add');
    expect(added).toHaveLength(1);
    expect(added[0].text).toBe('b');
  });

  it('detects removed lines', () => {
    const lines = computeDiffLines('a\nb\nc', 'a\nc');
    const removed = lines.filter((l) => l.type === 'remove');
    expect(removed).toHaveLength(1);
    expect(removed[0].text).toBe('b');
  });

  it('handles completely different text', () => {
    const lines = computeDiffLines('old', 'new');
    expect(lines).toEqual([
      { type: 'remove', text: 'old' },
      { type: 'add', text: 'new' },
    ]);
  });

  it('handles empty old text', () => {
    const lines = computeDiffLines('', 'a\nb');
    const added = lines.filter((l) => l.type === 'add');
    expect(added).toHaveLength(2);
  });

  it('handles empty new text', () => {
    const lines = computeDiffLines('a\nb', '');
    const removed = lines.filter((l) => l.type === 'remove');
    expect(removed).toHaveLength(2);
  });
});

describe('PromptDiffView', () => {
  it('renders diff lines with correct test ids', () => {
    const old = ['a', 'b'].join('\n');
    const next = ['a', 'c'].join('\n');
    render(<PromptDiffView oldPrompt={old} newPrompt={next} />);
    expect(screen.getByTestId('prompt-diff-view')).toBeInTheDocument();
    expect(screen.getAllByTestId('diff-line-equal')).toHaveLength(1);
    expect(screen.getAllByTestId('diff-line-remove')).toHaveLength(1);
    expect(screen.getAllByTestId('diff-line-add')).toHaveLength(1);
  });

  it('shows no changes message for identical prompts', () => {
    render(<PromptDiffView oldPrompt="same" newPrompt="same" />);
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });

  it('shows add/remove stats', () => {
    render(<PromptDiffView oldPrompt="old line" newPrompt="new line" />);
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });

  it('renders custom labels', () => {
    render(<PromptDiffView oldPrompt="a" newPrompt="b" oldLabel="v1.0" newLabel="v2.0" />);
    expect(screen.getByText('v1.0')).toBeInTheDocument();
    expect(screen.getByText('v2.0')).toBeInTheDocument();
  });
});
