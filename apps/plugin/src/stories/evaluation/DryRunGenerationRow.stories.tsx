import DryRunGenerationRow from '../../components/evaluation/DryRunGenerationRow';
import type { PreviewGenerationSample } from '../../evaluation/types';

const mockSample: PreviewGenerationSample = {
  generation_id: 'gen_abc123def456ghi789',
  conversation_id: 'conv_xyz789',
  agent_name: 'assistant-main',
  model: 'gpt-4o',
  created_at: '2026-03-02T14:32:00Z',
  input_preview: 'What is the capital of France? Please provide a brief answer.',
};

const mockSampleMinimal: PreviewGenerationSample = {
  generation_id: 'gen_short',
  conversation_id: 'conv_1',
  created_at: '2026-03-02T12:00:00Z',
};

const meta = {
  title: 'Sigil/Evaluation/DryRunGenerationRow',
  component: DryRunGenerationRow,
};

export default meta;

export const Default = {
  args: {
    sample: mockSample,
  },
};

export const Minimal = {
  args: {
    sample: mockSampleMinimal,
  },
};

export const LongInputPreview = {
  args: {
    sample: {
      ...mockSample,
      input_preview:
        'This is a very long input preview that should be truncated when displayed in the row component. It contains multiple sentences and demonstrates the truncation behavior.',
    },
  },
};
