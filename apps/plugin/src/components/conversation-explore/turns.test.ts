import type { GenerationDetail, Message } from '../../generation/types';
import { reconstructTurns, newMessagesForGeneration, messagesEqual } from './turns';

function msg(role: Message['role'], text: string): Message {
  return { role, parts: [{ text }] };
}

function user(text: string): Message {
  return msg('MESSAGE_ROLE_USER', text);
}

function assistant(text: string): Message {
  return msg('MESSAGE_ROLE_ASSISTANT', text);
}

function tool(name: string, content: string): Message {
  return { role: 'MESSAGE_ROLE_TOOL', parts: [{ tool_result: { tool_call_id: 'tc-1', name, content } }] };
}

function gen(
  id: string,
  time: string,
  input: Message[],
  output: Message[] = [],
  agentName?: string
): GenerationDetail {
  return {
    generation_id: id,
    conversation_id: 'conv-1',
    created_at: time,
    input,
    output,
    agent_name: agentName,
  };
}

// ---------------------------------------------------------------------------
// reconstructTurns
// ---------------------------------------------------------------------------

describe('reconstructTurns', () => {
  it('returns empty for empty input', () => {
    const g = gen('g1', '2026-01-01T00:00:00Z', []);
    expect(reconstructTurns([], g, [g])).toEqual({ turns: [], totalTurns: 0 });
  });

  it('falls back to role-based grouping for a single generation', () => {
    const g1 = gen('g1', '2026-01-01T00:00:00Z', [
      user('q1'), assistant('a1'), user('q2'),
    ]);

    const result = reconstructTurns(g1.input!, g1, [g1]);
    expect(result.totalTurns).toBe(2);
    expect(result.turns).toEqual([
      { number: 1, messages: [user('q1'), assistant('a1')], generationId: undefined },
      { number: 2, messages: [user('q2')], generationId: undefined },
    ]);
  });

  describe('chain diff', () => {
    it('reconstructs turns from a 3-generation cumulative chain', () => {
      const g1 = gen('g1', '2026-01-01T00:01:00Z', [user('q1')], [assistant('a1')]);
      const g2 = gen('g2', '2026-01-01T00:02:00Z',
        [user('q1'), assistant('a1'), user('q2')],
        [assistant('a2')]
      );
      const g3 = gen('g3', '2026-01-01T00:03:00Z',
        [user('q1'), assistant('a1'), user('q2'), assistant('a2'), user('q3')],
        [assistant('a3')]
      );

      const result = reconstructTurns(g3.input!, g3, [g1, g2, g3]);

      expect(result.totalTurns).toBe(3);
      expect(result.turns[0]).toEqual({
        number: 1, messages: [user('q1'), assistant('a1')], generationId: 'g1',
      });
      expect(result.turns[1]).toEqual({
        number: 2, messages: [user('q2'), assistant('a2')], generationId: 'g2',
      });
      expect(result.turns[2]).toEqual({
        number: 3, messages: [user('q3')], generationId: 'g3',
      });
    });

    it('reconstructs turns from a 2-generation chain', () => {
      const g1 = gen('g1', '2026-01-01T00:01:00Z', [user('q1')], [assistant('a1')]);
      const g2 = gen('g2', '2026-01-01T00:02:00Z',
        [user('q1'), assistant('a1'), user('q2')],
        [assistant('a2')]
      );

      const result = reconstructTurns(g2.input!, g2, [g1, g2]);

      expect(result.totalTurns).toBe(2);
      expect(result.turns[0].messages).toEqual([user('q1'), assistant('a1')]);
      expect(result.turns[1].messages).toEqual([user('q2')]);
    });
  });

  describe('missing intermediates', () => {
    it('splits a multi-user turn when an intermediate generation is missing', () => {
      const g1 = gen('g1', '2026-01-01T00:01:00Z', [user('q1')], [assistant('a1')]);
      // g2 is missing
      const g3 = gen('g3', '2026-01-01T00:03:00Z',
        [user('q1'), assistant('a1'), user('q2'), assistant('a2'), user('q3')],
        [assistant('a3')]
      );

      const result = reconstructTurns(g3.input!, g3, [g1, g3]);

      expect(result.totalTurns).toBe(3);
      expect(result.turns[0].messages).toEqual([user('q1'), assistant('a1')]);
      expect(result.turns[1].messages).toEqual([user('q2'), assistant('a2')]);
      expect(result.turns[2].messages).toEqual([user('q3')]);
    });
  });

  describe('multi-agent filtering', () => {
    it('ignores generations from other agents when building the chain', () => {
      const gA1 = gen('gA1', '2026-01-01T00:01:00Z', [user('q1')], [assistant('a1')], 'agent-A');
      const gB1 = gen('gB1', '2026-01-01T00:01:30Z',
        [user('sub-task')], [assistant('sub-result')], 'agent-B'
      );
      const gA2 = gen('gA2', '2026-01-01T00:02:00Z',
        [user('q1'), assistant('a1'), user('q2')],
        [assistant('a2')],
        'agent-A'
      );

      const all = [gA1, gB1, gA2];
      const result = reconstructTurns(gA2.input!, gA2, all);

      expect(result.totalTurns).toBe(2);
      expect(result.turns[0].messages).toEqual([user('q1'), assistant('a1')]);
      expect(result.turns[0].generationId).toBe('gA1');
      expect(result.turns[1].messages).toEqual([user('q2')]);
      expect(result.turns[1].generationId).toBe('gA2');
    });

    it('groups generations with no agent_name together', () => {
      const g1 = gen('g1', '2026-01-01T00:01:00Z', [user('q1')], [assistant('a1')]);
      const g2 = gen('g2', '2026-01-01T00:02:00Z',
        [user('q1'), assistant('a1'), user('q2')], [assistant('a2')]
      );

      const result = reconstructTurns(g2.input!, g2, [g1, g2]);
      expect(result.totalTurns).toBe(2);
    });

    it('treats trimmed-whitespace agent names as the same agent', () => {
      const g1 = gen('g1', '2026-01-01T00:01:00Z', [user('q1')], [assistant('a1')], '  myAgent  ');
      const g2 = gen('g2', '2026-01-01T00:02:00Z',
        [user('q1'), assistant('a1'), user('q2')], [assistant('a2')], 'myAgent'
      );

      const result = reconstructTurns(g2.input!, g2, [g1, g2]);
      expect(result.totalTurns).toBe(2);
    });
  });

  describe('branched conversations', () => {
    it('follows the correct branch and ignores sibling generations', () => {
      const g1 = gen('g1', '2026-01-01T00:01:00Z', [user('q1')], [assistant('a1')]);
      const g2a = gen('g2a', '2026-01-01T00:02:00Z',
        [user('q1'), assistant('a1'), user('q2')], [assistant('a2')]);
      const g2b = gen('g2b', '2026-01-01T00:02:30Z',
        [user('q1'), assistant('a1'), user('q2_retry')], [assistant('a2_retry')]);
      const g3 = gen('g3', '2026-01-01T00:03:00Z',
        [user('q1'), assistant('a1'), user('q2'), assistant('a2'), user('q3')], [assistant('a3')]);

      const result = reconstructTurns(g3.input!, g3, [g1, g2a, g2b, g3]);

      expect(result.totalTurns).toBe(3);
      expect(result.turns[0].generationId).toBe('g1');
      expect(result.turns[1].generationId).toBe('g2a');
      expect(result.turns[2].generationId).toBe('g3');
      expect(result.turns.every((t) => !t.prefixBreak)).toBe(true);
    });

    it('handles a retry at the latest turn without false divergence', () => {
      const g1 = gen('g1', '2026-01-01T00:01:00Z', [user('q1')], [assistant('a1')]);
      const g2_first = gen('g2f', '2026-01-01T00:02:00Z',
        [user('q1'), assistant('a1'), user('q2')], [assistant('a2_first')]);
      const g2_retry = gen('g2r', '2026-01-01T00:02:30Z',
        [user('q1'), assistant('a1'), user('q2')], [assistant('a2_retry')]);

      const result = reconstructTurns(g2_retry.input!, g2_retry, [g1, g2_first, g2_retry]);

      expect(result.totalTurns).toBe(2);
      expect(result.turns[0].generationId).toBe('g1');
      expect(result.turns[1].generationId).toBe('g2r');
      expect(result.turns.every((t) => !t.prefixBreak)).toBe(true);
    });
  });

  describe('prefix break detection', () => {
    it('marks a turn with prefixBreak when the previous output diverges from the input context', () => {
      const g1 = gen('g1', '2026-01-01T00:01:00Z',
        [user('q1')],
        [assistant('original answer')]
      );
      const g2 = gen('g2', '2026-01-01T00:02:00Z',
        [user('q1'), assistant('modified answer'), user('q2')],
        [assistant('a2')]
      );

      const result = reconstructTurns(g2.input!, g2, [g1, g2]);

      expect(result.totalTurns).toBe(2);
      expect(result.turns[0].prefixBreak).toBeFalsy();
      expect(result.turns[1].prefixBreak).toBe(true);
    });

    it('does not mark prefixBreak when output matches correctly', () => {
      const g1 = gen('g1', '2026-01-01T00:01:00Z', [user('q1')], [assistant('a1')]);
      const g2 = gen('g2', '2026-01-01T00:02:00Z',
        [user('q1'), assistant('a1'), user('q2')],
        [assistant('a2')]
      );

      const result = reconstructTurns(g2.input!, g2, [g1, g2]);

      expect(result.totalTurns).toBe(2);
      expect(result.turns[0].prefixBreak).toBeFalsy();
      expect(result.turns[1].prefixBreak).toBeFalsy();
    });
  });

  describe('rewritten messages', () => {
    it('shows the rewritten tail as the latest turn when prefix diverges', () => {
      const g1 = gen('g1', '2026-01-01T00:01:00Z',
        [user('q1'), assistant('a1'), user('old follow-up')],
        [assistant('old answer')]
      );
      const g2 = gen('g2', '2026-01-01T00:02:00Z',
        [user('q1'), assistant('a1'), user('rewritten follow-up')],
        [assistant('new answer')]
      );

      const result = reconstructTurns(g2.input!, g2, [g1, g2]);

      expect(result.totalTurns).toBe(2);
      expect(result.turns[0].messages).toEqual([user('q1'), assistant('a1')]);
      expect(result.turns[1].messages).toEqual([user('rewritten follow-up')]);
    });
  });

  describe('tool messages', () => {
    it('keeps tool messages within the same turn as the preceding user message', () => {
      const g1 = gen('g1', '2026-01-01T00:01:00Z',
        [user('q1')],
        [assistant('a1')]
      );
      const g2 = gen('g2', '2026-01-01T00:02:00Z',
        [user('q1'), assistant('a1'), user('q2'), tool('search', '{"hits":3}')],
        [assistant('a2')]
      );

      const result = reconstructTurns(g2.input!, g2, [g1, g2]);

      expect(result.totalTurns).toBe(2);
      expect(result.turns[1].messages).toEqual([user('q2'), tool('search', '{"hits":3}')]);
    });
  });

  describe('role-based fallback', () => {
    it('groups a multi-turn input with no generation history', () => {
      const g = gen('g1', '2026-01-01T00:00:00Z', [
        user('q1'), assistant('a1'),
        user('q2'), assistant('a2'),
        user('q3'),
      ]);

      const result = reconstructTurns(g.input!, g, [g]);

      expect(result.totalTurns).toBe(3);
      expect(result.turns[0].messages).toEqual([user('q1'), assistant('a1')]);
      expect(result.turns[1].messages).toEqual([user('q2'), assistant('a2')]);
      expect(result.turns[2].messages).toEqual([user('q3')]);
    });

    it('handles input starting with a non-user message', () => {
      const g = gen('g1', '2026-01-01T00:00:00Z', [
        assistant('system intro'), user('q1'),
      ]);

      const result = reconstructTurns(g.input!, g, [g]);

      expect(result.totalTurns).toBe(2);
      expect(result.turns[0].messages).toEqual([assistant('system intro')]);
      expect(result.turns[1].messages).toEqual([user('q1')]);
    });
  });
});

// ---------------------------------------------------------------------------
// newMessagesForGeneration
// ---------------------------------------------------------------------------

describe('newMessagesForGeneration', () => {
  it('returns all input when there is no previous generation', () => {
    const g = gen('g1', '2026-01-01T00:00:00Z', [user('q1')]);
    expect(newMessagesForGeneration(g, undefined)).toEqual([user('q1')]);
  });

  it('returns only the appended tail for cumulative histories', () => {
    const prev = gen('g1', '2026-01-01T00:01:00Z', [user('q1')], [assistant('a1')]);
    const curr = gen('g2', '2026-01-01T00:02:00Z',
      [user('q1'), assistant('a1'), user('q2')],
      [assistant('a2')]
    );
    expect(newMessagesForGeneration(curr, prev)).toEqual([user('q2')]);
  });

  it('returns the latest user turn when history is rewritten', () => {
    const prev = gen('g1', '2026-01-01T00:01:00Z',
      [user('q1'), assistant('a1'), user('old')],
      [assistant('old-a')]
    );
    const curr = gen('g2', '2026-01-01T00:02:00Z',
      [user('q1'), assistant('a1'), user('rewritten')],
      [assistant('new-a')]
    );

    const result = newMessagesForGeneration(curr, prev);
    expect(result).toEqual([user('rewritten')]);
  });

  it('returns empty for empty input', () => {
    const g = gen('g1', '2026-01-01T00:00:00Z', []);
    expect(newMessagesForGeneration(g, undefined)).toEqual([]);
  });

  it('returns empty when previous transcript fully covers current input', () => {
    const prev = gen('g1', '2026-01-01T00:01:00Z', [user('q1')], [assistant('a1')]);
    const curr = gen('g2', '2026-01-01T00:02:00Z',
      [user('q1'), assistant('a1')],
      [assistant('a2')]
    );
    expect(newMessagesForGeneration(curr, prev)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// messagesEqual
// ---------------------------------------------------------------------------

describe('messagesEqual', () => {
  it('returns true for identical messages', () => {
    expect(messagesEqual(user('hello'), user('hello'))).toBe(true);
  });

  it('returns false for different text', () => {
    expect(messagesEqual(user('hello'), user('world'))).toBe(false);
  });

  it('returns false for different roles', () => {
    expect(messagesEqual(user('hello'), assistant('hello'))).toBe(false);
  });

  it('matches tool calls by id and name, ignoring input_json serialization differences', () => {
    const a: Message = {
      role: 'MESSAGE_ROLE_ASSISTANT',
      parts: [{ tool_call: { id: 'tc-1', name: 'search', input_json: '{"a":1,"b":2}' } }],
    };
    const b: Message = {
      role: 'MESSAGE_ROLE_ASSISTANT',
      parts: [{ tool_call: { id: 'tc-1', name: 'search', input_json: '{"b":2,"a":1}' } }],
    };
    expect(messagesEqual(a, b)).toBe(true);
  });

  it('matches tool results by id and name, ignoring content serialization differences', () => {
    const a: Message = {
      role: 'MESSAGE_ROLE_TOOL',
      parts: [{ tool_result: { tool_call_id: 'tc-1', name: 'search', content: '{"x":1,"y":2}' } }],
    };
    const b: Message = {
      role: 'MESSAGE_ROLE_TOOL',
      parts: [{ tool_result: { tool_call_id: 'tc-1', name: 'search', content: '{"y":2,"x":1}' } }],
    };
    expect(messagesEqual(a, b)).toBe(true);
  });
});
