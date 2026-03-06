import TemplateConfigSummary from '../../components/evaluation/TemplateConfigSummary';

const meta = {
  title: 'Sigil/Evaluation/TemplateConfigSummary',
  component: TemplateConfigSummary,
};

export default meta;

export const LLMJudge = {
  args: {
    kind: 'llm_judge',
    config: {
      system_prompt:
        'You evaluate one assistant response. Use only the user input and assistant output. Follow the score field description exactly. Be strict. If uncertain, choose the lower score.',
      user_prompt: 'User input:\n{{input}}\n\nAssistant output:\n{{output}}',
      max_tokens: 128,
      temperature: 0,
    },
    outputKeys: [
      {
        key: 'helpfulness',
        type: 'number',
        description:
          '1-2 does not solve the request, 3-4 partially helpful, 5-6 adequate but incomplete, 7-8 helpful and mostly complete, 9-10 fully solves the request with clear useful detail',
        pass_threshold: 7,
        min: 1,
        max: 10,
      },
    ],
  },
};

export const JSONSchema = {
  args: {
    kind: 'json_schema',
    config: {
      schema: {
        type: 'object',
        required: ['answer'],
        properties: {
          answer: { type: 'string' },
        },
      },
    },
    outputKeys: [
      {
        key: 'json_valid',
        type: 'bool',
        description: 'True if the response is valid JSON and satisfies the configured schema',
        pass_value: true,
      },
    ],
  },
};

export const Heuristic = {
  args: {
    kind: 'heuristic',
    config: {
      not_empty: true,
      min_length: 12,
      max_length: 400,
      contains: ['answer'],
      not_contains: ['lorem ipsum'],
    },
    outputKeys: [
      {
        key: 'response_length',
        type: 'bool',
        description: 'True if the response length is between 12 and 400 bytes',
        pass_value: true,
      },
    ],
  },
};
