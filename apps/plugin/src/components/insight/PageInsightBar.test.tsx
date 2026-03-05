import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { PageInsightBar, clearGenerateLockForTests } from './PageInsightBar';

const mockGenerate = jest.fn();
const mockOpenAssistant = jest.fn();
let mockIsGenerating = false;
let mockContent = '';

jest.mock('@grafana/assistant', () => ({
  useAssistant: () => ({
    openAssistant: mockOpenAssistant,
  }),
  createAssistantContextItem: jest.fn((_type: string, params: { title?: string }) => ({
    node: {
      id: 'sigil-context',
      name: params.title ?? 'Sigil knowledgebase',
      navigable: false,
      selectable: true,
      data: { type: 'structured' },
    },
    occurrences: [],
  })),
  useInlineAssistant: () => ({
    isGenerating: mockIsGenerating,
    content: mockContent,
    generate: mockGenerate,
  }),
}));

describe('PageInsightBar', () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockOpenAssistant.mockReset();
    mockIsGenerating = false;
    mockContent = '';
    localStorage.clear();
    clearGenerateLockForTests();
  });

  it('defaults to collapsed when no localStorage value', () => {
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext={null} />);
    expect(screen.getByRole('button', { name: 'No insights available' })).toBeInTheDocument();
    expect(screen.queryByText('Waiting for data...')).not.toBeInTheDocument();
  });

  it('cannot be expanded when there is no content', () => {
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext={null} />);
    const toggle = screen.getByRole('button', { name: 'No insights available' });
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(toggle);
    expect(screen.queryByText('No notable insights.')).not.toBeInTheDocument();
  });

  it('renders waiting placeholder when expanded with no data', () => {
    localStorage.setItem('sigil.insightBar.collapsed', '0');
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext={null} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('auto-generates on first render when expanded and data context is provided', () => {
    localStorage.setItem('sigil.insightBar.collapsed', '0');
    render(<PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="some data" />);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Analyze this'),
        origin: 'test-origin',
      })
    );
  });

  it('does not auto-generate again when data context changes while a scoped request lock is active', () => {
    const { rerender } = render(
      <PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="initial data" />
    );
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    rerender(<PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="updated data" />);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('shows placeholder while generating with no content', () => {
    localStorage.setItem('sigil.insightBar.collapsed', '0');
    mockIsGenerating = true;
    mockContent = '';
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext="data" />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders collapse/expand toggle', () => {
    localStorage.setItem('sigil.insightBar.collapsed', '0');
    mockGenerate.mockImplementation(({ onComplete }: { onComplete: (r: string) => void }) => {
      onComplete('- Finding one\n- Finding two');
    });
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext="data" />);

    const toggle = screen.getByRole('button', { name: 'Collapse insights' });
    expect(toggle).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Expand insights' })).toBeInTheDocument();
  });

  it('renders insight bullets after completion', () => {
    localStorage.setItem('sigil.insightBar.collapsed', '0');
    mockGenerate.mockImplementation(({ onComplete }: { onComplete: (r: string) => void }) => {
      onComplete('- **Error rate** spiked to 5%\n- Token usage is normal');
    });
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext="data" />);
    expect(screen.getByText(/Error rate/)).toBeInTheDocument();
    expect(screen.getByText(/Token usage is normal/)).toBeInTheDocument();
  });

  it('cannot expand when result is empty', () => {
    localStorage.setItem('sigil.insightBar.collapsed', '1');
    mockGenerate.mockImplementation(({ onComplete }: { onComplete: (r: string) => void }) => {
      onComplete('');
    });
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext="data" />);
    const toggle = screen.getByRole('button', { name: 'No insights available' });
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(toggle);
    expect(screen.queryByText('No notable insights.')).not.toBeInTheDocument();
  });

  it('can still collapse when expanded and result is empty', () => {
    localStorage.setItem('sigil.insightBar.collapsed', '0');
    mockGenerate.mockImplementation(({ onComplete }: { onComplete: (r: string) => void }) => {
      onComplete('');
    });
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext="data" />);
    const toggle = screen.getByRole('button', { name: 'Collapse insights' });
    expect(toggle).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'No insights available' })).toBeInTheDocument();
  });

  it('persists collapsed state in localStorage', () => {
    localStorage.setItem('sigil.insightBar.collapsed', '0');
    mockGenerate.mockImplementation(({ onComplete }: { onComplete: (r: string) => void }) => {
      onComplete('- Finding one');
    });
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext="data" />);

    const toggle = screen.getByRole('button', { name: 'Collapse insights' });
    fireEvent.click(toggle);
    expect(localStorage.getItem('sigil.insightBar.collapsed')).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Expand insights' }));
    expect(localStorage.getItem('sigil.insightBar.collapsed')).toBe('0');
  });

  it('starts collapsed when localStorage has collapsed state', () => {
    localStorage.setItem('sigil.insightBar.collapsed', '1');
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext="data" />);
    expect(screen.getByRole('button', { name: 'No insights available' })).toBeInTheDocument();
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('does not regenerate when data context changes with fresh fallback cache', () => {
    mockGenerate.mockImplementation(({ onComplete }: { onComplete: (r: string) => void }) => {
      onComplete('- Fresh insight');
    });
    const { rerender } = render(
      <PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="initial data" />
    );
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    rerender(<PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="updated data" />);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('shows fallback insight and skips regenerating after data context change with fresh cache', () => {
    mockGenerate.mockImplementation(({ onComplete }: { onComplete: (r: string) => void }) => {
      onComplete('- Prior context insight');
    });
    const { rerender } = render(
      <PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="initial data" />
    );
    expect(screen.getByText(/Prior context insight/)).toBeInTheDocument();

    mockGenerate.mockReset();
    mockGenerate.mockImplementation(jest.fn());

    rerender(<PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="updated data" />);

    expect(mockGenerate).not.toHaveBeenCalled();
    expect(screen.getByText(/Prior context insight/)).toBeInTheDocument();
  });

  it('regenerates when prompt changes with same data context', () => {
    const { rerender } = render(<PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="same data" />);
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    rerender(<PageInsightBar prompt="Analyze differently" origin="test-origin" dataContext="same data" />);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('does not regenerate on reload when fallback cache is fresher than 5m', () => {
    mockGenerate.mockImplementation(({ onComplete }: { onComplete: (r: string) => void }) => {
      onComplete('- Fresh insight');
    });

    const { unmount } = render(
      <PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="initial data" />
    );
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    unmount();
    mockGenerate.mockReset();

    render(<PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="updated data" />);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(screen.getByText(/Fresh insight/)).toBeInTheDocument();
  });
});
