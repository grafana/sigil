import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { PageInsightBar } from './PageInsightBar';

const mockGenerate = jest.fn();
let mockIsGenerating = false;
let mockContent = '';

jest.mock('@grafana/assistant', () => ({
  useInlineAssistant: () => ({
    isGenerating: mockIsGenerating,
    content: mockContent,
    generate: mockGenerate,
  }),
}));

describe('PageInsightBar', () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockIsGenerating = false;
    mockContent = '';
    localStorage.removeItem('sigil.insightBar.collapsed');
  });

  it('defaults to collapsed when no localStorage value', () => {
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext={null} />);
    expect(screen.getByRole('button', { name: 'Expand insights' })).toBeInTheDocument();
    expect(screen.queryByText('Waiting for data...')).not.toBeInTheDocument();
  });

  it('renders waiting placeholder when expanded with no data', () => {
    localStorage.setItem('sigil.insightBar.collapsed', '0');
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext={null} />);
    expect(screen.getByText('Waiting for data...')).toBeInTheDocument();
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

  it('shows placeholder while generating with no content', () => {
    localStorage.setItem('sigil.insightBar.collapsed', '0');
    mockIsGenerating = true;
    mockContent = '';
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext="data" />);
    expect(screen.getByText('Generating insight...')).toBeInTheDocument();
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

  it('shows no-insights placeholder when result is empty', () => {
    localStorage.setItem('sigil.insightBar.collapsed', '0');
    mockGenerate.mockImplementation(({ onComplete }: { onComplete: (r: string) => void }) => {
      onComplete('');
    });
    render(<PageInsightBar prompt="Analyze" origin="test" dataContext="data" />);
    expect(screen.getByText('No notable insights.')).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Expand insights' })).toBeInTheDocument();
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
