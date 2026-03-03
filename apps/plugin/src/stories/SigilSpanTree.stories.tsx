import React from 'react';
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
  startTimeUnixNano: BigInt('1772480417578390317'),
  endTimeUnixNano: BigInt('1772480418152390318'),
  durationNano: BigInt('574000001'),
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

const errorSpan = makeSpan({
  spanID: 'span-6',
  name: 'HTTP POST',
  serviceName: 'cloudwatch-exporter',
  startTimeUnixNano: BigInt('1772480418152390318'),
  endTimeUnixNano: BigInt('1772480418185390318'),
  durationNano: BigInt('33000000'),
  attributes: makeAttrs([
    ['error.type', 'timeout'],
    ['gen_ai.operation.name', 'execute_tool'],
  ]),
});

const demoSpans: ConversationSpan[] = [generationSpan, frameworkSpan, errorSpan];

function makeJaegerLikeTree(): ConversationSpan[] {
  const branches: ConversationSpan[] = [];

  for (let i = 0; i < 6; i += 1) {
    const client = makeSpan({
      spanID: `cw-client-${i}`,
      parentSpanID: 'cw-root',
      name: 'aws.sts_getcalleridentity',
      serviceName: 'cloudwatch-exporter',
      startTimeUnixNano: BigInt(`1772480418${20 + i}52390318`),
      endTimeUnixNano: BigInt(`1772480418${23 + i}82390318`),
      durationNano: BigInt('32940000'),
      attributes: makeAttrs([['http.method', 'POST']]),
    });

    const httpPost = makeSpan({
      spanID: `cw-post-${i}`,
      parentSpanID: client.spanID,
      name: 'HTTP POST',
      serviceName: 'cloudwatch-exporter',
      startTimeUnixNano: BigInt(`1772480418${20 + i}52390319`),
      endTimeUnixNano: BigInt(`1772480418${23 + i}92390319`),
      durationNano: BigInt('33040000'),
      attributes: makeAttrs([
        ['http.method', 'POST'],
        ['error.type', 'timeout'],
      ]),
    });

    client.children = [httpPost];
    branches.push(client);
  }

  const root = makeSpan({
    spanID: 'cw-root',
    name: 'hminstance_instance_id_metadata',
    serviceName: 'cloudwatch-exporter',
    startTimeUnixNano: BigInt('1772480417578390317'),
    endTimeUnixNano: BigInt('1772480432208390317'),
    durationNano: BigInt('14630000000'),
    children: branches,
  });

  const sideRoot = makeSpan({
    spanID: 'other-root',
    name: 'db.query user_profile',
    serviceName: 'postgres',
    startTimeUnixNano: BigInt('1772480417578390317'),
    endTimeUnixNano: BigInt('1772480417600390317'),
    durationNano: BigInt('22000000'),
  });

  return [root, sideRoot];
}

const jaegerLikeSpans = makeJaegerLikeTree();

const meta = {
  title: 'Sigil/Sigil Span Tree',
  component: SigilSpanTree,
  args: {
    spans: demoSpans,
  },
};

export default meta;

export const Default = {};

export const JaegerLikeNarrow = {
  args: {
    spans: jaegerLikeSpans,
    selectedSpanSelectionID: 'trace-1:cw-client-2',
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div style={{ width: 700, border: '1px solid #2f3742' }}>
        <Story />
      </div>
    ),
  ],
};

export const DeepAndScrollable = {
  args: {
    spans: [
      ...jaegerLikeSpans,
      ...Array.from({ length: 8 }).map((_, index) =>
        makeSpan({
          spanID: `async-${index}`,
          name: `background.worker.${index}`,
          serviceName: `worker-${index % 3}`,
          startTimeUnixNano: BigInt(`1772480419${index}52390318`),
          endTimeUnixNano: BigInt(`1772480419${index}92390318`),
          durationNano: BigInt('40000000'),
        })
      ),
    ],
  },
};
