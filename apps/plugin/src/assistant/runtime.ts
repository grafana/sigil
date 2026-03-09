export type ChatContextItem = {
  type: string;
  node: {
    name: string;
  };
  [key: string]: unknown;
};

export type OpenAssistantArgs = {
  origin: string;
  prompt?: string;
  context?: ChatContextItem[];
  autoSend?: boolean;
};

export type AssistantBridge = {
  openAssistant?: (args: OpenAssistantArgs) => void;
};

export type InlineGenerateArgs = {
  agentName: string;
  agentId: string;
  prompt: string;
  origin: string;
  systemPrompt?: string;
  onComplete: (result: string) => void;
  onError: (err: Error) => void;
};

export type InlineAssistantBridge = {
  isGenerating: boolean;
  content: string;
  generate: (args: InlineGenerateArgs) => void;
};

const FALLBACK_ASSISTANT: AssistantBridge = {};

const FALLBACK_INLINE_ASSISTANT: InlineAssistantBridge = {
  isGenerating: false,
  content: '',
  generate: ({ onError }) => {
    onError(
      new Error('InlineAssistant not initialized. Make sure the Grafana Assistant plugin is loaded and initialized.')
    );
  },
};

export function useAssistant(): AssistantBridge {
  return FALLBACK_ASSISTANT;
}

export function useInlineAssistant(): InlineAssistantBridge {
  return FALLBACK_INLINE_ASSISTANT;
}

export function createAssistantContextItem(type: string, params: Record<string, unknown>): ChatContextItem {
  return {
    type,
    node: {
      name: typeof params.title === 'string' ? params.title : 'Context item',
    },
    ...params,
  };
}
