import DryRunPreview from '../../components/evaluation/DryRunPreview';
import type { RulePreviewResponse } from '../../evaluation/types';

const mockPreview: RulePreviewResponse = {
  window_hours: 24,
  total_generations: 15420,
  matching_generations: 3200,
  sampled_generations: 320,
  samples: [
    {
      generation_id: 'gen_abc123def456',
      conversation_id: 'conv_xyz789',
      agent_name: 'assistant-main',
      model: 'gpt-4o',
      created_at: '2026-03-02T14:32:00Z',
      input_preview: 'What is the capital of France? Please provide a brief answer.',
    },
    {
      generation_id: 'gen_ghi789jkl012',
      conversation_id: 'conv_uvw456',
      agent_name: 'assistant-support',
      model: 'claude-3-sonnet',
      created_at: '2026-03-02T13:15:00Z',
      input_preview: 'Summarize the following document in 3 bullet points...',
    },
    {
      generation_id: 'gen_mno345pqr678',
      conversation_id: 'conv_rst123',
      created_at: '2026-03-02T12:00:00Z',
      input_preview: undefined,
    },
  ],
};

const meta = {
  title: 'Sigil/Evaluation/DryRunPreview',
  component: DryRunPreview,
};

export default meta;

export const Loading = {
  args: {
    preview: null,
    loading: true,
  },
};

export const Empty = {
  args: {
    preview: null,
    loading: false,
  },
};

export const WithData = {
  args: {
    preview: mockPreview,
    loading: false,
  },
};

export const EmptySamples = {
  args: {
    preview: {
      ...mockPreview,
      samples: [],
      matching_generations: 0,
      sampled_generations: 0,
    },
    loading: false,
  },
};
