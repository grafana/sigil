import type { ConversationDetail, ConversationSearchResult, GenerationDetail, Message } from '../conversation/types';

export const mockUserTextMessage: Message = {
  role: 'MESSAGE_ROLE_USER',
  parts: [{ text: 'Can you help me find the top 5 most popular programming languages in 2025?' }],
};

export const mockAssistantWithThinking: Message = {
  role: 'MESSAGE_ROLE_ASSISTANT',
  parts: [
    {
      thinking:
        'The user is asking about popular programming languages. I should use the search tool to find up-to-date information rather than relying on my training data. Let me search for recent rankings.',
    },
    { text: 'Let me search for the latest programming language rankings.' },
    {
      tool_call: {
        id: 'tc-001',
        name: 'web_search',
        input_json: '{\n  "query": "top programming languages 2025 ranking",\n  "max_results": 5\n}',
      },
    },
  ],
};

export const mockToolResult: Message = {
  role: 'MESSAGE_ROLE_TOOL',
  name: 'web_search',
  parts: [
    {
      tool_result: {
        tool_call_id: 'tc-001',
        name: 'web_search',
        content_json:
          '{\n  "results": [\n    {"title": "TIOBE Index 2025", "snippet": "Python, C++, Java, C#, JavaScript lead the rankings..."},\n    {"title": "Stack Overflow Survey 2025", "snippet": "JavaScript most used, Rust most loved..."}\n  ]\n}',
      },
    },
  ],
};

export const mockAssistantFinalAnswer: Message = {
  role: 'MESSAGE_ROLE_ASSISTANT',
  parts: [
    {
      text: `Based on recent data, here are the top 5 most popular programming languages in 2025:

1. **Python** - Dominant in AI/ML, data science, and general purpose
2. **JavaScript** - Still the most widely used for web development
3. **Java** - Enterprise applications and Android development
4. **C++** - Systems programming, gaming, and high-performance computing
5. **C#** - Game development (Unity) and enterprise .NET applications

Python has maintained its #1 spot primarily due to the AI boom. JavaScript continues to be essential for web development with frameworks like React and Next.js.`,
    },
  ],
};

export const mockToolResultError: Message = {
  role: 'MESSAGE_ROLE_TOOL',
  parts: [
    {
      tool_result: {
        tool_call_id: 'tc-err',
        name: 'database_query',
        content: 'Connection timeout after 30s: could not reach database host db-prod-01.internal:5432',
        is_error: true,
      },
    },
  ],
};

export const mockAssistantWithCodeBlock: Message = {
  role: 'MESSAGE_ROLE_ASSISTANT',
  parts: [
    {
      text: `Here's a simple Python script to get started:

\`\`\`python
import requests

def fetch_rankings():
    response = requests.get("https://api.example.com/languages")
    data = response.json()
    for lang in data["languages"][:5]:
        print(f"{lang['rank']}. {lang['name']} - {lang['score']}")

if __name__ == "__main__":
    fetch_rankings()
\`\`\`

You can run this with \`python script.py\` to see the results.`,
    },
  ],
};

export const mockInputMessages: Message[] = [mockUserTextMessage];
export const mockOutputMessages: Message[] = [mockAssistantWithThinking, mockToolResult, mockAssistantFinalAnswer];

export const mockFullConversationMessages: Message[] = [
  mockUserTextMessage,
  mockAssistantWithThinking,
  mockToolResult,
  mockAssistantFinalAnswer,
];

export const mockGenerationDetail: GenerationDetail = {
  generation_id: 'gen-abc-123',
  conversation_id: 'conv-xyz-789',
  trace_id: 'trace-def-456',
  span_id: 'span-001',
  mode: 'SYNC',
  model: { provider: 'anthropic', name: 'claude-sonnet-4-5' },
  agent_name: 'research-assistant',
  agent_version: '2.1.0',
  system_prompt:
    'You are a helpful research assistant. Use the available tools to find accurate, up-to-date information. Always cite your sources. Be concise but thorough.',
  input: [mockUserTextMessage],
  output: [mockAssistantWithThinking, mockToolResult, mockAssistantFinalAnswer],
  tools: [
    { name: 'web_search', description: 'Search the web for information', type: 'function' },
    { name: 'database_query', description: 'Query the internal database', type: 'function' },
  ],
  usage: {
    input_tokens: 256,
    output_tokens: 512,
    total_tokens: 768,
    cache_read_input_tokens: 128,
    reasoning_tokens: 64,
  },
  stop_reason: 'end_turn',
  created_at: '2026-02-15T10:05:30Z',
};

export const mockGenerationWithError: GenerationDetail = {
  generation_id: 'gen-err-001',
  conversation_id: 'conv-xyz-789',
  mode: 'STREAM',
  model: { provider: 'openai', name: 'gpt-4o' },
  input: [{ role: 'MESSAGE_ROLE_USER', parts: [{ text: 'Query the database for sales data' }] }],
  output: [
    {
      role: 'MESSAGE_ROLE_ASSISTANT',
      parts: [{ tool_call: { id: 'tc-err', name: 'database_query', input_json: '{"sql":"SELECT * FROM sales"}' } }],
    },
    mockToolResultError,
  ],
  error: { message: 'Tool execution failed: database connection timeout' },
  created_at: '2026-02-15T10:10:00Z',
};

export const mockConversationDetail: ConversationDetail = {
  conversation_id: 'conv-xyz-789',
  generation_count: 3,
  first_generation_at: '2026-02-15T10:00:00Z',
  last_generation_at: '2026-02-15T10:10:00Z',
  generations: [
    {
      generation_id: 'gen-abc-001',
      conversation_id: 'conv-xyz-789',
      trace_id: 'trace-001',
      mode: 'SYNC',
      created_at: '2026-02-15T10:00:00Z',
      model: { provider: 'anthropic', name: 'claude-sonnet-4-5' },
    },
    {
      generation_id: 'gen-abc-002',
      conversation_id: 'conv-xyz-789',
      trace_id: 'trace-002',
      mode: 'SYNC',
      created_at: '2026-02-15T10:05:00Z',
      model: { provider: 'anthropic', name: 'claude-sonnet-4-5' },
    },
    {
      generation_id: 'gen-abc-003',
      conversation_id: 'conv-xyz-789',
      trace_id: 'trace-003',
      mode: 'STREAM',
      created_at: '2026-02-15T10:10:00Z',
      model: { provider: 'openai', name: 'gpt-4o' },
    },
  ],
  rating_summary: { total_count: 2, good_count: 1, bad_count: 1, has_bad_rating: true },
  annotations: [
    {
      annotation_id: 'ann-1',
      conversation_id: 'conv-xyz-789',
      annotation_type: 'NOTE',
      body: 'Reviewed - tool call timing needs investigation',
      operator_id: 'user-1',
      operator_name: 'Alice',
      created_at: '2026-02-15T10:15:00Z',
    },
  ],
};

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

export const mockSearchResults: ConversationSearchResult[] = [
  {
    conversation_id: '269c1e8e-d588-448e-8e44-6f45286ab234',
    generation_count: 7,
    first_generation_at: minutesAgo(15),
    last_generation_at: minutesAgo(3),
    models: ['claude-haiku-4-5@20251001', 'claude-sonnet-4-6'],
    agents: ['research-assistant', 'code-review-bot'],
    error_count: 5,
    has_errors: true,
    trace_ids: ['trace-001', 'trace-002', 'trace-003'],
    rating_summary: { total_count: 2, good_count: 1, bad_count: 1, has_bad_rating: true },
    annotation_count: 1,
  },
  {
    conversation_id: 'ae6ca6f3-a28e-4fc4-8a65-1f575847518a',
    generation_count: 45,
    first_generation_at: minutesAgo(120),
    last_generation_at: minutesAgo(5),
    models: ['claude-haiku-4-5@20251001', 'claude-sonnet-4-6'],
    agents: ['triage-bot'],
    error_count: 17,
    has_errors: true,
    trace_ids: ['trace-100'],
    annotation_count: 0,
  },
  {
    conversation_id: 'acb97888-53bf-4eb7-8feb-f4415eedb4d1',
    generation_count: 10,
    first_generation_at: minutesAgo(90),
    last_generation_at: minutesAgo(15),
    models: ['claude-haiku-4-5@20251001', 'claude-sonnet-4-6'],
    agents: ['code-review-bot'],
    error_count: 5,
    has_errors: true,
    trace_ids: ['trace-200', 'trace-201'],
    rating_summary: { total_count: 3, good_count: 3, bad_count: 0, has_bad_rating: false },
    annotation_count: 2,
  },
  {
    conversation_id: '99f040ea-f545-4da3-9759-533256450c8e',
    generation_count: 12,
    first_generation_at: minutesAgo(200),
    last_generation_at: minutesAgo(20),
    models: ['claude-haiku-4-5@20251001', 'claude-sonnet-4-6'],
    agents: ['research-assistant'],
    error_count: 3,
    has_errors: true,
    trace_ids: ['trace-300'],
    annotation_count: 0,
  },
  {
    conversation_id: '9aa95962-eff6-4169-aa65-a83c9fadaac8',
    generation_count: 40,
    first_generation_at: minutesAgo(300),
    last_generation_at: minutesAgo(25),
    models: ['claude-haiku-4-5@20251001', 'claude-sonnet-4-6'],
    agents: ['research-assistant', 'triage-bot', 'code-review-bot', 'docs-bot'],
    error_count: 20,
    has_errors: true,
    trace_ids: ['trace-400'],
    annotation_count: 0,
  },
  {
    conversation_id: '89af1bec-fec6-4a12-abe5-66a4adec52bc',
    generation_count: 16,
    first_generation_at: minutesAgo(60),
    last_generation_at: minutesAgo(35),
    models: ['claude-haiku-4-5@20251001', 'claude-sonnet-4-6'],
    agents: [],
    error_count: 0,
    has_errors: false,
    trace_ids: ['trace-500'],
    rating_summary: { total_count: 1, good_count: 1, bad_count: 0, has_bad_rating: false },
    annotation_count: 0,
  },
  {
    conversation_id: '15c16c73-a85e-4bb9-881e-d4ddc665a7e4',
    generation_count: 1,
    first_generation_at: minutesAgo(42),
    last_generation_at: minutesAgo(40),
    models: ['claude-haiku-4-5@20251001'],
    agents: ['triage-bot'],
    error_count: 0,
    has_errors: false,
    trace_ids: ['trace-600'],
    annotation_count: 0,
  },
  {
    conversation_id: '828120de-311a-468d-8c1c-7a63fc99da01',
    generation_count: 1,
    first_generation_at: minutesAgo(50),
    last_generation_at: minutesAgo(48),
    models: ['claude-haiku-4-5@20251001'],
    agents: [],
    error_count: 0,
    has_errors: false,
    trace_ids: ['trace-700'],
    annotation_count: 0,
  },
  {
    conversation_id: 'bd84a0b3-232b-47c1-99fa-a0d07e41a4e4b',
    generation_count: 2,
    first_generation_at: minutesAgo(70),
    last_generation_at: minutesAgo(55),
    models: ['claude-haiku-4-5@20251001', 'claude-sonnet-4-6'],
    agents: ['research-assistant'],
    error_count: 0,
    has_errors: false,
    trace_ids: ['trace-800'],
    rating_summary: { total_count: 1, good_count: 1, bad_count: 0, has_bad_rating: false },
    annotation_count: 0,
  },
  {
    conversation_id: '25a6774a-ecc6-4b81-bc75-dc7fcf5dfd2c',
    generation_count: 2,
    first_generation_at: minutesAgo(80),
    last_generation_at: minutesAgo(65),
    models: ['claude-sonnet-4-6'],
    agents: [],
    error_count: 1,
    has_errors: true,
    trace_ids: ['trace-900'],
    annotation_count: 0,
  },
];
