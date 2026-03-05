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

  it('renders waiting placeholder when data context is null', () => {
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext={null} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('auto-generates on first render when data context is provided', () => {
    render(<PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="some data" />);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Analyze this'),
        origin: 'test-origin',
      })
    );
  });

  it('auto-generates again when data context changes', () => {
    const { rerender } = render(
      <PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="initial data" />
    );
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    rerender(<PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="updated data" />);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockGenerate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('updated data'),
        origin: 'test-origin',
      })
    );
  });

  it('shows placeholder while generating with no content', () => {
    mockIsGenerating = true;
    mockContent = '';
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext="data" />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders collapse/expand toggle', () => {
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
    mockGenerate.mockImplementation(({ onComplete }: { onComplete: (r: string) => void }) => {
      onComplete('- **Error rate** spiked to 5%\n- Token usage is normal');
    });
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext="data" />);
    expect(screen.getByText(/Error rate/)).toBeInTheDocument();
    expect(screen.getByText(/Token usage is normal/)).toBeInTheDocument();
  });

  it('shows no-insights placeholder when result is empty', () => {
    mockGenerate.mockImplementation(({ onComplete }: { onComplete: (r: string) => void }) => {
      onComplete('');
    });
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext="data" />);
    expect(screen.getByText('No notable insights.')).toBeInTheDocument();
  });

  it('persists collapsed state in localStorage', () => {
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
    expect(screen.getByRole('button', { name: 'Expand insights' })).toBeInTheDocument();
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('regenerates when data context changes even with fresh fallback cache', () => {
    mockGenerate.mockImplementation(({ onComplete }: { onComplete: (r: string) => void }) => {
      onComplete('- Fresh insight');
    });
    const { rerender } = render(
      <PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="initial data" />
    );
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    rerender(<PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="updated data" />);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('shows fallback insight while regenerating after data context change', () => {
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

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Prior context insight/)).toBeInTheDocument();
  });

  it('regenerates when prompt changes with same data context', () => {
    const { rerender } = render(<PageInsightBar prompt="Analyze this" origin="test-origin" dataContext="same data" />);
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    rerender(<PageInsightBar prompt="Analyze differently" origin="test-origin" dataContext="same data" />);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });
});
