import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PLUGIN_BASE } from '../constants';
import App, { isChromeLightRoute } from './App';

// ResizeObserver is not available in JSDOM.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb(
        [{ target, contentRect: { width: 600, height: 300 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('isChromeLightRoute', () => {
  it('uses chrome-light layout for list and focused pages only', () => {
    expect(isChromeLightRoute('conversations')).toBe(true);
    expect(isChromeLightRoute('conversations/conv-1/view')).toBe(true);
    expect(isChromeLightRoute('conversations/conv-1/explore')).toBe(true);
    expect(isChromeLightRoute('agents')).toBe(true);
    expect(isChromeLightRoute('evaluation')).toBe(true);
    expect(isChromeLightRoute('evaluation/runs')).toBe(true);
  });

  it('keeps detail pages on padded layout', () => {
    expect(isChromeLightRoute('conversations/conv-1/detail')).toBe(false);
    expect(isChromeLightRoute('agents/name/some-agent')).toBe(false);
    expect(isChromeLightRoute('agents/anonymous')).toBe(false);
  });

  it('sets document title without duplicating app name on root routes', async () => {
    document.title = 'Home - Grafana';

    const props: any = {
      basename: PLUGIN_BASE,
      onNavChanged: jest.fn(),
    };

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: [PLUGIN_BASE] },
        React.createElement(App, props)
      )
    );

    await waitFor(() => {
      expect(document.title).toBe('Sigil - Grafana');
    });
  });
});
