import type { ConversationSpan, SpanAttributeValue } from './types';
import {
  getStringAttr,
  getIntAttr,
  getFloatAttr,
  getBoolAttr,
  getStringArrayAttr,
  getIdentity,
  getRequest,
  getResponse,
  getTokenUsage,
  getToolInfo,
  getEmbeddingInfo,
  getErrorInfo,
  getFrameworkInfo,
  ATTR_OPERATION_NAME,
  ATTR_SDK_NAME,
  ATTR_REQUEST_MODEL,
  ATTR_REQUEST_TEMPERATURE,
  ATTR_REQUEST_THINKING_ENABLED,
  ATTR_RESPONSE_FINISH_REASONS,
  ATTR_USAGE_INPUT_TOKENS,
  ATTR_TOOL_NAME,
  ATTR_ERROR_TYPE,
  ATTR_FRAMEWORK_NAME,
  ATTR_FRAMEWORK_TAGS,
} from './attributes';

function makeAttrs(entries: Array<[string, SpanAttributeValue]>): ReadonlyMap<string, SpanAttributeValue> {
  return new Map(entries);
}

function makeSpan(entries: Array<[string, SpanAttributeValue]>): ConversationSpan {
  return {
    traceID: 'trace-1',
    spanID: 'span-1',
    parentSpanID: '',
    name: 'test',
    kind: 'CLIENT',
    serviceName: 'svc',
    startTimeUnixNano: BigInt(0),
    endTimeUnixNano: BigInt(1000000),
    durationNano: BigInt(1000000),
    attributes: makeAttrs(entries),
    generation: null,
    children: [],
  };
}

describe('getStringAttr', () => {
  it.each([
    { desc: 'returns stringValue', value: { stringValue: 'hello' }, expected: 'hello' },
    { desc: 'returns undefined for missing key', value: undefined, expected: undefined },
    { desc: 'returns undefined for intValue only', value: { intValue: '42' }, expected: undefined },
  ])('$desc', ({ value, expected }) => {
    const attrs = value ? makeAttrs([['key', value]]) : makeAttrs([]);
    expect(getStringAttr(attrs, 'key')).toBe(expected);
  });
});

describe('getIntAttr', () => {
  it.each([
    { desc: 'parses intValue', value: { intValue: '42' }, expected: 42 },
    { desc: 'parses stringValue as int', value: { stringValue: '99' }, expected: 99 },
    { desc: 'truncates float in stringValue', value: { stringValue: '3.7' }, expected: 3 },
    { desc: 'returns undefined for non-numeric', value: { stringValue: 'abc' }, expected: undefined },
    { desc: 'returns undefined for missing', value: undefined, expected: undefined },
  ])('$desc', ({ value, expected }) => {
    const attrs = value ? makeAttrs([['key', value]]) : makeAttrs([]);
    expect(getIntAttr(attrs, 'key')).toBe(expected);
  });
});

describe('getFloatAttr', () => {
  it.each([
    { desc: 'parses doubleValue', value: { doubleValue: '0.75' }, expected: 0.75 },
    { desc: 'parses intValue as float', value: { intValue: '10' }, expected: 10 },
    { desc: 'returns undefined for missing', value: undefined, expected: undefined },
  ])('$desc', ({ value, expected }) => {
    const attrs = value ? makeAttrs([['key', value]]) : makeAttrs([]);
    expect(getFloatAttr(attrs, 'key')).toBe(expected);
  });
});

describe('getBoolAttr', () => {
  it.each([
    { desc: 'returns boolValue true', value: { boolValue: true }, expected: true },
    { desc: 'returns boolValue false', value: { boolValue: false }, expected: false },
    { desc: 'parses string true', value: { stringValue: 'true' }, expected: true },
    { desc: 'parses string false', value: { stringValue: 'false' }, expected: false },
    { desc: 'returns undefined for missing', value: undefined, expected: undefined },
  ])('$desc', ({ value, expected }) => {
    const attrs = value ? makeAttrs([['key', value]]) : makeAttrs([]);
    expect(getBoolAttr(attrs, 'key')).toBe(expected);
  });
});

describe('getStringArrayAttr', () => {
  it('returns array of stringValues', () => {
    const attrs = makeAttrs([['key', { arrayValue: { values: [{ stringValue: 'a' }, { stringValue: 'b' }] } }]]);
    expect(getStringArrayAttr(attrs, 'key')).toEqual(['a', 'b']);
  });

  it('returns undefined for missing key', () => {
    expect(getStringArrayAttr(makeAttrs([]), 'key')).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    const attrs = makeAttrs([['key', { arrayValue: { values: [] } }]]);
    expect(getStringArrayAttr(attrs, 'key')).toBeUndefined();
  });
});

describe('getIdentity', () => {
  it('extracts identity fields', () => {
    const span = makeSpan([
      [ATTR_OPERATION_NAME, { stringValue: 'generateText' }],
      [ATTR_SDK_NAME, { stringValue: 'sdk-go' }],
    ]);
    const id = getIdentity(span);
    expect(id.operationName).toBe('generateText');
    expect(id.sdkName).toBe('sdk-go');
    expect(id.agentName).toBeUndefined();
  });
});

describe('getRequest', () => {
  it('extracts request fields', () => {
    const span = makeSpan([
      [ATTR_REQUEST_MODEL, { stringValue: 'gpt-4o' }],
      [ATTR_REQUEST_TEMPERATURE, { doubleValue: '0.7' }],
      [ATTR_REQUEST_THINKING_ENABLED, { boolValue: true }],
    ]);
    const req = getRequest(span);
    expect(req.model).toBe('gpt-4o');
    expect(req.temperature).toBeCloseTo(0.7);
    expect(req.thinkingEnabled).toBe(true);
    expect(req.maxTokens).toBeUndefined();
  });
});

describe('getResponse', () => {
  it('extracts response with finish reasons array', () => {
    const span = makeSpan([[ATTR_RESPONSE_FINISH_REASONS, { arrayValue: { values: [{ stringValue: 'stop' }] } }]]);
    const resp = getResponse(span);
    expect(resp.finishReasons).toEqual(['stop']);
  });
});

describe('getTokenUsage', () => {
  it('extracts standard and provider-specific tokens', () => {
    const span = makeSpan([[ATTR_USAGE_INPUT_TOKENS, { intValue: '1000' }]]);
    const usage = getTokenUsage(span);
    expect(usage.inputTokens).toBe(1000);
    expect(usage.outputTokens).toBeUndefined();
  });
});

describe('getToolInfo', () => {
  it('extracts tool fields', () => {
    const span = makeSpan([[ATTR_TOOL_NAME, { stringValue: 'search' }]]);
    expect(getToolInfo(span).name).toBe('search');
  });
});

describe('getEmbeddingInfo', () => {
  it('returns empty for non-embedding span', () => {
    const info = getEmbeddingInfo(makeSpan([]));
    expect(info.inputCount).toBeUndefined();
  });
});

describe('getErrorInfo', () => {
  it('extracts error type and category', () => {
    const span = makeSpan([[ATTR_ERROR_TYPE, { stringValue: 'provider_call_error' }]]);
    expect(getErrorInfo(span).type).toBe('provider_call_error');
  });
});

describe('getFrameworkInfo', () => {
  it('extracts framework fields including tags', () => {
    const span = makeSpan([
      [ATTR_FRAMEWORK_NAME, { stringValue: 'langchain' }],
      [ATTR_FRAMEWORK_TAGS, { arrayValue: { values: [{ stringValue: 'prod' }] } }],
    ]);
    const fw = getFrameworkInfo(span);
    expect(fw.name).toBe('langchain');
    expect(fw.tags).toEqual(['prod']);
  });
});
