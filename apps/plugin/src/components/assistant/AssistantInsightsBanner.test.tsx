import React from 'react';
import { act, render, screen } from '@testing-library/react';
import AssistantInsightsBanner from './AssistantInsightsBanner';

const mockGenerate = jest.fn();
const mockOpenAssistant = jest.fn();
let mockIsGenerating = false;

jest.mock('@grafana/assistant', () => ({
  useInlineAssistant: () => ({
    isGenerating: mockIsGenerating,
    generate: mockGenerate,
  }),
  useAssistant: () => ({
    openAssistant: mockOpenAssistant,
  }),
}));

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

describe('AssistantInsightsBanner', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mockGenerate.mockReset();
    mockOpenAssistant.mockReset();
    mockIsGenerating = false;
    localStorage.clear();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      configurable: true,
      value: ResizeObserverMock,
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  it('keeps the current insight visible when a background refresh fails', () => {
    let callCount = 0;
    mockGenerate.mockImplementation(
      ({ onComplete, onError }: { onComplete: (result: string) => void; onError: (err: Error) => void }) => {
        callCount += 1;
        if (callCount === 1) {
          window.setTimeout(() => onComplete('- Existing insight remains visible'), 0);
          return;
        }
        window.setTimeout(() => onError(new Error('refresh failed')), 0);
      }
    );

    render(
      <AssistantInsightsBanner
        prompt="Summarize this dashboard"
        origin="test-origin"
        systemPrompt="test-system-prompt"
        dataContext="test-context"
      />
    );

    expect(mockGenerate).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.getByLabelText('AI generated insights')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('AI generated insights')).toBeInTheDocument();
  });
});
