import { decodeBase64Json, formatJson, humanizeRole, parseMessages } from './messageParser';
import type { MessageRole } from './types';

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return btoa(String.fromCharCode(...bytes));
}

describe('decodeBase64Json', () => {
  it('decodes valid base64 to UTF-8 string', () => {
    const encoded = btoa('{"key":"value"}');
    expect(decodeBase64Json(encoded)).toBe('{"key":"value"}');
  });

  it('decodes non-ascii UTF-8 strings', () => {
    const encoded = encodeUtf8Base64('{"message":"café ☕"}');
    expect(decodeBase64Json(encoded)).toBe('{"message":"café ☕"}');
  });

  it('returns raw string when base64 decode fails', () => {
    expect(decodeBase64Json('not-valid-base64!!!')).toBe('not-valid-base64!!!');
  });

  it('handles empty string', () => {
    expect(decodeBase64Json('')).toBe('');
  });
});

describe('humanizeRole', () => {
  const cases: Array<{ role: MessageRole; expected: string }> = [
    { role: 'MESSAGE_ROLE_USER', expected: 'User' },
    { role: 'MESSAGE_ROLE_ASSISTANT', expected: 'Assistant' },
    { role: 'MESSAGE_ROLE_TOOL', expected: 'Tool' },
  ];

  it.each(cases)('maps $role to $expected', ({ role, expected }) => {
    expect(humanizeRole(role)).toBe(expected);
  });

  it('returns Unknown for unrecognized role', () => {
    expect(humanizeRole('SOMETHING_ELSE' as MessageRole)).toBe('Unknown');
  });
});

describe('formatJson', () => {
  it('pretty-prints valid JSON', () => {
    expect(formatJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('returns raw string for invalid JSON', () => {
    expect(formatJson('not json')).toBe('not json');
  });
});

describe('parseMessages', () => {
  it('returns empty array for undefined input', () => {
    expect(parseMessages(undefined)).toEqual([]);
  });

  it('returns empty array for null input', () => {
    expect(parseMessages(null)).toEqual([]);
  });

  it('returns empty array for empty array', () => {
    expect(parseMessages([])).toEqual([]);
  });

  it('parses a valid text message', () => {
    const raw = [
      {
        role: 'MESSAGE_ROLE_USER',
        parts: [{ text: 'Hello!' }],
      },
    ];
    const result = parseMessages(raw);
    expect(result).toEqual([
      {
        role: 'MESSAGE_ROLE_USER',
        parts: [{ text: 'Hello!' }],
      },
    ]);
  });

  it('parses message with name field', () => {
    const raw = [
      {
        role: 'MESSAGE_ROLE_TOOL',
        name: 'search_tool',
        parts: [{ tool_result: { tool_call_id: 'tc-1', name: 'search', content: 'found 3 results' } }],
      },
    ];
    const result = parseMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('search_tool');
  });

  it('parses multi-part message with text and thinking', () => {
    const raw = [
      {
        role: 'MESSAGE_ROLE_ASSISTANT',
        parts: [{ thinking: 'Let me consider...' }, { text: 'Here is my answer.' }],
      },
    ];
    const result = parseMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].parts).toHaveLength(2);
    expect(result[0].parts[0].thinking).toBe('Let me consider...');
    expect(result[0].parts[1].text).toBe('Here is my answer.');
  });

  it('parses tool_call with base64 input_json', () => {
    const inputJson = '{"query":"test"}';
    const encoded = btoa(inputJson);
    const raw = [
      {
        role: 'MESSAGE_ROLE_ASSISTANT',
        parts: [{ tool_call: { id: 'tc-1', name: 'search', input_json: encoded } }],
      },
    ];
    const result = parseMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].parts[0].tool_call).toEqual({
      id: 'tc-1',
      name: 'search',
      input_json: inputJson,
    });
  });

  it('parses tool_result with base64 content_json', () => {
    const contentJson = '{"results":[1,2,3]}';
    const encoded = btoa(contentJson);
    const raw = [
      {
        role: 'MESSAGE_ROLE_TOOL',
        parts: [{ tool_result: { tool_call_id: 'tc-1', name: 'search', content_json: encoded } }],
      },
    ];
    const result = parseMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].parts[0].tool_result?.content_json).toBe(contentJson);
  });

  it('parses tool_result with UTF-8 content_json', () => {
    const contentJson = '{"message":"café ☕"}';
    const encoded = encodeUtf8Base64(contentJson);
    const raw = [
      {
        role: 'MESSAGE_ROLE_TOOL',
        parts: [{ tool_result: { tool_call_id: 'tc-1', name: 'search', content_json: encoded } }],
      },
    ];
    const result = parseMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].parts[0].tool_result?.content_json).toBe(contentJson);
  });

  it('parses tool_result with is_error flag', () => {
    const raw = [
      {
        role: 'MESSAGE_ROLE_TOOL',
        parts: [{ tool_result: { tool_call_id: 'tc-1', name: 'search', content: 'timeout', is_error: true } }],
      },
    ];
    const result = parseMessages(raw);
    expect(result[0].parts[0].tool_result?.is_error).toBe(true);
  });

  it('drops messages with invalid role', () => {
    const raw = [
      { role: 'INVALID_ROLE', parts: [{ text: 'hello' }] },
      { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'valid' }] },
    ];
    const result = parseMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('MESSAGE_ROLE_USER');
  });

  it('drops messages with missing role', () => {
    const raw = [{ parts: [{ text: 'no role' }] }];
    expect(parseMessages(raw)).toEqual([]);
  });

  it('drops messages with no valid parts', () => {
    const raw = [{ role: 'MESSAGE_ROLE_USER', parts: [{}] }];
    expect(parseMessages(raw)).toEqual([]);
  });

  it('drops messages with missing parts array', () => {
    const raw = [{ role: 'MESSAGE_ROLE_USER' }];
    expect(parseMessages(raw)).toEqual([]);
  });

  it('drops malformed non-object entries', () => {
    const raw = ['string', 42, null, true, { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'ok' }] }];
    const result = parseMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].parts[0].text).toBe('ok');
  });

  it('preserves part metadata', () => {
    const raw = [
      {
        role: 'MESSAGE_ROLE_ASSISTANT',
        parts: [{ metadata: { provider_type: 'openai' }, text: 'response' }],
      },
    ];
    const result = parseMessages(raw);
    expect(result[0].parts[0].metadata).toEqual({ provider_type: 'openai' });
  });

  it('handles multi-message conversation', () => {
    const raw = [
      { role: 'MESSAGE_ROLE_USER', parts: [{ text: 'What is 2+2?' }] },
      {
        role: 'MESSAGE_ROLE_ASSISTANT',
        parts: [{ thinking: 'Simple arithmetic' }, { text: '4' }],
      },
    ];
    const result = parseMessages(raw);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('MESSAGE_ROLE_USER');
    expect(result[1].role).toBe('MESSAGE_ROLE_ASSISTANT');
    expect(result[1].parts).toHaveLength(2);
  });
});
