import React, { useEffect } from 'react';
import { render } from '@testing-library/react';
import {
  createAssistantContextItem,
  useAssistant,
  useInlineAssistant,
  type AssistantBridge,
  type InlineAssistantBridge,
} from './runtime';

describe('assistant runtime fallback', () => {
  it('returns safe fallback assistant bridges when the assistant module is unavailable', () => {
    let assistant: AssistantBridge | undefined;
    let inline: InlineAssistantBridge | undefined;

    function Probe() {
      const assistantValue = useAssistant();
      const inlineValue = useInlineAssistant();

      useEffect(() => {
        assistant = assistantValue;
        inline = inlineValue;
      }, [assistantValue, inlineValue]);

      return null;
    }

    render(<Probe />);

    expect(assistant).toEqual({});
    expect(inline?.isGenerating).toBe(false);
    expect(inline?.content).toBe('');

    const onError = jest.fn();
    inline?.generate({
      agentName: 'insights',
      agentId: 'v1',
      prompt: 'test',
      origin: 'sigil/test',
      onComplete: jest.fn(),
      onError,
    });

    expect(onError).toHaveBeenCalledWith(
      new Error('InlineAssistant not initialized. Make sure the Grafana Assistant plugin is loaded and initialized.')
    );
  });

  it('creates plain context items without depending on the assistant package', () => {
    expect(createAssistantContextItem('structured', { title: 'Sigil', data: { name: 'Sigil' } })).toEqual({
      type: 'structured',
      node: {
        name: 'Sigil',
      },
      title: 'Sigil',
      data: { name: 'Sigil' },
    });
  });
});
