import SigilSpanTree from '../components/conversations/SigilSpanTree';
import type { ConversationSpan, SpanAttributeValue } from '../conversation/types';

function makeAttrs(entries: Array<[string, string]>): ReadonlyMap<string, SpanAttributeValue> {
  return new Map(entries.map(([key, value]) => [key, { stringValue: value }]));
}

function makeSpan({
  spanID,
  name,
  ...overrides
}: Partial<ConversationSpan> & { spanID: string; name: string }): ConversationSpan {
  return {
    traceID: 'trace-1',
    spanID,
    parentSpanID: '',
    name,
    kind: 'CLIENT',
    serviceName: 'llm-gateway',
    startTimeUnixNano: BigInt('1772480417578390317'),
    endTimeUnixNano: BigInt('1772480417752390317'),
    durationNano: BigInt('173999000'),
    attributes: new Map(),
    generation: null,
    children: [],
    ...overrides,
  };
}

const evalSpan = makeSpan({
  spanID: 'span-3',
  parentSpanID: 'span-2',
  name: 'sigil.eval.score',
  serviceName: 'eval-worker',
  startTimeUnixNano: BigInt('1772480417852390318'),
  endTimeUnixNano: BigInt('1772480417952390318'),
  durationNano: BigInt('100000000'),
  attributes: makeAttrs([['sigil.score.name', 'helpfulness']]),
});

const toolSpan = makeSpan({
  spanID: 'span-2',
  parentSpanID: 'span-1',
  name: 'sigil.tool.call',
  startTimeUnixNano: BigInt('1772480417752390318'),
  endTimeUnixNano: BigInt('1772480417852390318'),
  durationNano: BigInt('100000000'),
  attributes: makeAttrs([
    ['gen_ai.operation.name', 'execute_tool'],
    ['gen_ai.tool.name', 'web_search'],
  ]),
  children: [evalSpan],
});

const embeddingSpan = makeSpan({
  spanID: 'span-4',
  parentSpanID: 'span-1',
  name: 'embeddings text-embedding-3-small',
  startTimeUnixNano: BigInt('1772480417952390318'),
  endTimeUnixNano: BigInt('1772480418052390318'),
  durationNano: BigInt('100000000'),
  attributes: makeAttrs([['gen_ai.operation.name', 'embeddings']]),
});

const generationSpan = makeSpan({
  spanID: 'span-1',
  name: 'sigil.generation.prompt',
  attributes: makeAttrs([
    ['sigil.generation.id', 'gen-1'],
    ['gen_ai.operation.name', 'generateText'],
  ]),
  children: [toolSpan, embeddingSpan],
});

const frameworkSpan = makeSpan({
  spanID: 'span-5',
  name: 'sigil.framework.chain chat-openai',
  serviceName: 'framework-worker',
  startTimeUnixNano: BigInt('1772480418052390318'),
  endTimeUnixNano: BigInt('1772480418152390318'),
  durationNano: BigInt('100000000'),
  attributes: makeAttrs([['sigil.framework.name', 'langchain']]),
});

const demoSpans: ConversationSpan[] = [generationSpan, frameworkSpan];

const meta = {
  title: 'Sigil/Sigil Span Tree',
  component: SigilSpanTree,
  args: {
    spans: demoSpans,
  },
};

export default meta;

export const Default = {};
