import SigilSpanTree from '../components/conversations/SigilSpanTree';
import type { SigilSpan } from '../conversation/traceSpans';

const demoSpans: SigilSpan[] = [
  {
    traceID: 'trace-1',
    spanID: 'span-1',
    parentSpanID: '',
    name: 'sigil.generation.prompt',
    serviceName: 'llm-gateway',
    startNs: BigInt('1772480417578390317'),
    endNs: BigInt('1772480417752390317'),
    durationNs: BigInt('173999000'),
    selectionID: 'trace-1:span-1',
    attributes: { 'sigil.generation.id': 'gen-1' },
    sigilKind: 'generation',
  },
  {
    traceID: 'trace-1',
    spanID: 'span-2',
    parentSpanID: 'span-1',
    name: 'sigil.tool.call',
    serviceName: 'llm-gateway',
    startNs: BigInt('1772480417752390318'),
    endNs: BigInt('1772480417852390318'),
    durationNs: BigInt('100000000'),
    selectionID: 'trace-1:span-2',
    attributes: { 'sigil.tool.name': 'web_search' },
    sigilKind: 'tool',
  },
  {
    traceID: 'trace-1',
    spanID: 'span-3',
    parentSpanID: 'span-2',
    name: 'sigil.eval.score',
    serviceName: 'eval-worker',
    startNs: BigInt('1772480417852390318'),
    endNs: BigInt('1772480417952390318'),
    durationNs: BigInt('100000000'),
    selectionID: 'trace-1:span-3',
    attributes: { 'sigil.score.name': 'helpfulness' },
    sigilKind: 'evaluation',
  },
  {
    traceID: 'trace-1',
    spanID: 'span-4',
    parentSpanID: 'span-1',
    name: 'embeddings text-embedding-3-small',
    serviceName: 'llm-gateway',
    startNs: BigInt('1772480417952390318'),
    endNs: BigInt('1772480418052390318'),
    durationNs: BigInt('100000000'),
    selectionID: 'trace-1:span-4',
    attributes: { 'gen_ai.operation.name': 'embeddings' },
    sigilKind: 'model',
  },
  {
    traceID: 'trace-1',
    spanID: 'span-5',
    parentSpanID: '',
    name: 'sigil.framework.chain chat-openai',
    serviceName: 'framework-worker',
    startNs: BigInt('1772480418052390318'),
    endNs: BigInt('1772480418152390318'),
    durationNs: BigInt('100000000'),
    selectionID: 'trace-1:span-5',
    attributes: { 'sigil.framework.name': 'langchain' },
    sigilKind: 'other',
  },
];

const meta = {
  title: 'Sigil/Sigil Span Tree',
  component: SigilSpanTree,
  args: {
    spans: demoSpans,
  },
};

export default meta;

export const Default = {};
