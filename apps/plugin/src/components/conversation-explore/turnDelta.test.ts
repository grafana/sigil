import type { GenerationDetail, Message } from '../../generation/types';
import { getDisplayedInputMessages } from './turnDelta';

function makeGeneration(input: Message[], output: Message[] = []): GenerationDetail {
  return {
    generation_id: `gen-${input.length}-${output.length}`,
    conversation_id: 'conv-1',
    input,
    output,
  };
}

describe('getDisplayedInputMessages', () => {
  it('returns only the appended tail for cumulative input histories', () => {
    const previous = makeGeneration(
      [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'question 1' }] }],
      [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'answer 1' }] }]
    );
    const currentInput: Message[] = [
      { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'question 1' }] },
      { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'answer 1' }] },
      { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'question 2' }] },
    ];

    expect(getDisplayedInputMessages(currentInput, previous)).toEqual([
      { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'question 2' }] },
    ]);
  });

  it('drops unchanged overlap when the current input starts from a trimmed history window', () => {
    const previous = makeGeneration(
      [
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'question 1' }] },
        { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'answer 1' }] },
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'question 2' }] },
      ],
      [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'answer 2' }] }]
    );
    const currentInput: Message[] = [
      { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'question 2' }] },
      { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'answer 2' }] },
      { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'question 3' }] },
    ];

    expect(getDisplayedInputMessages(currentInput, previous)).toEqual([
      { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'question 3' }] },
    ]);
  });

  it('falls back to the latest effective input turn when the history was rewritten', () => {
    const previous = makeGeneration(
      [
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'question 1' }] },
        { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'answer 1' }] },
        { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'question 2' }] },
      ],
      [{ role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'answer 2' }] }]
    );
    const currentInput: Message[] = [
      { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'question 1' }] },
      { role: 'MESSAGE_ROLE_ASSISTANT', parts: [{ text: 'answer 1' }] },
      { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'rewritten question 2' }] },
    ];

    expect(getDisplayedInputMessages(currentInput, previous)).toEqual([
      { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'rewritten question 2' }] },
    ]);
  });
});
