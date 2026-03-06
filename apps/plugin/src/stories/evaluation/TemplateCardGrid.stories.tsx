import TemplateCardGrid from '../../components/evaluation/TemplateCardGrid';
import type { TemplateDefinition } from '../../evaluation/types';

const mockTemplates: TemplateDefinition[] = [
  {
    tenant_id: 'tenant-1',
    template_id: 'my-org.custom-helpfulness',
    scope: 'tenant',
    kind: 'llm_judge',
    description: 'Custom helpfulness evaluator tuned for our product domain and support workflows.',
    latest_version: '2026-03-01',
    output_keys: [{ key: 'score', type: 'number' }],
    versions: [],
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
  },
  {
    tenant_id: '',
    template_id: 'sigil.helpfulness',
    scope: 'global',
    kind: 'llm_judge',
    description: 'Score how helpful and complete the assistant response is for the user request.',
    latest_version: '2026-03-05',
    output_keys: [{ key: 'score', type: 'number' }],
    versions: [],
    created_at: '2026-03-03T00:00:00Z',
    updated_at: '2026-03-03T00:00:00Z',
  },
  {
    tenant_id: '',
    template_id: 'sigil.json_valid',
    scope: 'global',
    kind: 'json_schema',
    description: 'Return true when the response is valid JSON matching the provided schema.',
    latest_version: '2026-03-05',
    output_keys: [{ key: 'json_valid', type: 'bool' }],
    versions: [],
    created_at: '2026-03-03T00:00:00Z',
    updated_at: '2026-03-03T00:00:00Z',
  },
];

const meta = {
  title: 'Sigil/Evaluation/TemplateCardGrid',
  component: TemplateCardGrid,
};

export default meta;

export const Default = {
  args: {
    templates: mockTemplates,
    onSelect: (id: string) => {
      console.log('View:', id);
    },
    onFork: (id: string) => {
      console.log('Fork:', id);
    },
    onDelete: (id: string) => {
      console.log('Delete:', id);
    },
  },
};
