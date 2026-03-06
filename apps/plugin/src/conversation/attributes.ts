import type { ConversationSpan, SpanAttributes, SpanAttributeValue } from './types';

// ── Core Identity ──
export const ATTR_GENERATION_ID = 'sigil.generation.id';
export const ATTR_SDK_NAME = 'sigil.sdk.name';
export const ATTR_OPERATION_NAME = 'gen_ai.operation.name';
export const ATTR_PROVIDER_NAME = 'gen_ai.provider.name';
export const ATTR_CONVERSATION_ID = 'gen_ai.conversation.id';
export const ATTR_CONVERSATION_TITLE = 'sigil.conversation.title';
export const ATTR_CONVERSATION_TITLE_LEGACY = 'conversation_title';
export const ATTR_AGENT_NAME = 'gen_ai.agent.name';
export const ATTR_AGENT_VERSION = 'gen_ai.agent.version';

// ── Request ──
export const ATTR_REQUEST_MODEL = 'gen_ai.request.model';
export const ATTR_REQUEST_MAX_TOKENS = 'gen_ai.request.max_tokens';
export const ATTR_REQUEST_TEMPERATURE = 'gen_ai.request.temperature';
export const ATTR_REQUEST_TOP_P = 'gen_ai.request.top_p';
export const ATTR_REQUEST_ENCODING_FORMATS = 'gen_ai.request.encoding_formats';
export const ATTR_REQUEST_TOOL_CHOICE = 'sigil.gen_ai.request.tool_choice';
export const ATTR_REQUEST_THINKING_ENABLED = 'sigil.gen_ai.request.thinking.enabled';
export const ATTR_REQUEST_THINKING_BUDGET = 'sigil.gen_ai.request.thinking.budget_tokens';
export const ATTR_REQUEST_THINKING_LEVEL = 'sigil.gen_ai.request.thinking.level';

// ── Response ──
export const ATTR_RESPONSE_ID = 'gen_ai.response.id';
export const ATTR_RESPONSE_MODEL = 'gen_ai.response.model';
export const ATTR_RESPONSE_FINISH_REASONS = 'gen_ai.response.finish_reasons';

// ── Token Usage (standard) ──
export const ATTR_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
export const ATTR_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
export const ATTR_USAGE_CACHE_READ_TOKENS = 'gen_ai.usage.cache_read_input_tokens';
export const ATTR_USAGE_CACHE_WRITE_TOKENS = 'gen_ai.usage.cache_write_input_tokens';
export const ATTR_USAGE_CACHE_CREATION_TOKENS = 'gen_ai.usage.cache_creation_input_tokens';
export const ATTR_USAGE_REASONING_TOKENS = 'gen_ai.usage.reasoning_tokens';

// ── Token Usage (provider-specific metadata) ──
export const ATTR_USAGE_TOOL_USE_PROMPT_TOKENS = 'sigil.gen_ai.usage.tool_use_prompt_tokens';
export const ATTR_USAGE_SERVER_TOOL_USE_WEB_SEARCH = 'sigil.gen_ai.usage.server_tool_use.web_search_requests';
export const ATTR_USAGE_SERVER_TOOL_USE_WEB_FETCH = 'sigil.gen_ai.usage.server_tool_use.web_fetch_requests';
export const ATTR_USAGE_SERVER_TOOL_USE_TOTAL = 'sigil.gen_ai.usage.server_tool_use.total_requests';

// ── Embeddings ──
export const ATTR_EMBEDDINGS_INPUT_COUNT = 'gen_ai.embeddings.input_count';
export const ATTR_EMBEDDINGS_INPUT_TEXTS = 'gen_ai.embeddings.input_texts';
export const ATTR_EMBEDDINGS_DIMENSION_COUNT = 'gen_ai.embeddings.dimension.count';

// ── Tool Execution ──
export const ATTR_TOOL_NAME = 'gen_ai.tool.name';
export const ATTR_TOOL_CALL_ID = 'gen_ai.tool.call.id';
export const ATTR_TOOL_TYPE = 'gen_ai.tool.type';
export const ATTR_TOOL_DESCRIPTION = 'gen_ai.tool.description';
export const ATTR_TOOL_CALL_ARGUMENTS = 'gen_ai.tool.call.arguments';
export const ATTR_TOOL_CALL_RESULT = 'gen_ai.tool.call.result';

// ── Error ──
export const ATTR_ERROR_TYPE = 'error.type';
export const ATTR_ERROR_CATEGORY = 'error.category';

// ── Framework ──
export const ATTR_FRAMEWORK_NAME = 'sigil.framework.name';
export const ATTR_FRAMEWORK_SOURCE = 'sigil.framework.source';
export const ATTR_FRAMEWORK_LANGUAGE = 'sigil.framework.language';
export const ATTR_FRAMEWORK_RUN_ID = 'sigil.framework.run_id';
export const ATTR_FRAMEWORK_THREAD_ID = 'sigil.framework.thread_id';
export const ATTR_FRAMEWORK_PARENT_RUN_ID = 'sigil.framework.parent_run_id';
export const ATTR_FRAMEWORK_COMPONENT_NAME = 'sigil.framework.component_name';
export const ATTR_FRAMEWORK_RUN_TYPE = 'sigil.framework.run_type';
export const ATTR_FRAMEWORK_RETRY_ATTEMPT = 'sigil.framework.retry_attempt';
export const ATTR_FRAMEWORK_LANGGRAPH_NODE = 'sigil.framework.langgraph.node';
export const ATTR_FRAMEWORK_EVENT_ID = 'sigil.framework.event_id';
export const ATTR_FRAMEWORK_TAGS = 'sigil.framework.tags';
export const ATTR_FRAMEWORK_STEP_TYPE = 'sigil.framework.step_type';
export const ATTR_FRAMEWORK_REASONING_TEXT = 'sigil.framework.reasoning_text';

// ── Known value enums ──

export const OperationName = {
  GenerateText: 'generateText',
  StreamText: 'streamText',
  Embeddings: 'embeddings',
  ExecuteTool: 'execute_tool',
  FrameworkChain: 'framework_chain',
  FrameworkRetriever: 'framework_retriever',
} as const;

export const ErrorType = {
  ProviderCallError: 'provider_call_error',
  MappingError: 'mapping_error',
  ValidationError: 'validation_error',
  EnqueueError: 'enqueue_error',
  ToolExecutionError: 'tool_execution_error',
  FrameworkError: 'framework_error',
} as const;

export const ErrorCategory = {
  RateLimit: 'rate_limit',
  ServerError: 'server_error',
  AuthError: 'auth_error',
  Timeout: 'timeout',
  ClientError: 'client_error',
  SDKError: 'sdk_error',
} as const;

export const SDKName = {
  Go: 'sdk-go',
  JS: 'sdk-js',
  Python: 'sdk-python',
  Java: 'sdk-java',
  DotNet: 'sdk-dotnet',
} as const;

export const FrameworkName = {
  LangChain: 'langchain',
  LangGraph: 'langgraph',
  OpenAIAgents: 'openai-agents',
  LlamaIndex: 'llamaindex',
  GoogleADK: 'google-adk',
  VercelAI: 'vercel-ai-sdk',
} as const;

export const FrameworkSource = {
  Handler: 'handler',
  Framework: 'framework',
} as const;

export const FrameworkStepType = {
  Initial: 'initial',
  Continue: 'continue',
  ToolResult: 'tool-result',
} as const;

// ── Low-level typed getters ──

function resolveValue(v: SpanAttributeValue | undefined): SpanAttributeValue | undefined {
  return v;
}

export function getStringAttr(attrs: SpanAttributes, key: string): string | undefined {
  const v = resolveValue(attrs.get(key));
  if (v?.stringValue !== undefined) {
    return v.stringValue;
  }
  return undefined;
}

export function getIntAttr(attrs: SpanAttributes, key: string): number | undefined {
  const v = resolveValue(attrs.get(key));
  if (v?.intValue !== undefined) {
    const n = Number(v.intValue);
    if (Number.isFinite(n)) {
      return Math.trunc(n);
    }
  }
  if (v?.stringValue !== undefined) {
    const n = Number(v.stringValue);
    if (Number.isFinite(n)) {
      return Math.trunc(n);
    }
  }
  return undefined;
}

export function getFloatAttr(attrs: SpanAttributes, key: string): number | undefined {
  const v = resolveValue(attrs.get(key));
  if (v?.doubleValue !== undefined) {
    const n = Number(v.doubleValue);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  if (v?.intValue !== undefined) {
    const n = Number(v.intValue);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  if (v?.stringValue !== undefined) {
    const n = Number(v.stringValue);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return undefined;
}

export function getBoolAttr(attrs: SpanAttributes, key: string): boolean | undefined {
  const v = resolveValue(attrs.get(key));
  if (v?.boolValue !== undefined) {
    return v.boolValue;
  }
  if (v?.stringValue !== undefined) {
    const lower = v.stringValue.toLowerCase();
    if (lower === 'true') {
      return true;
    }
    if (lower === 'false') {
      return false;
    }
  }
  return undefined;
}

export function getStringArrayAttr(attrs: SpanAttributes, key: string): string[] | undefined {
  const v = resolveValue(attrs.get(key));
  if (v?.arrayValue?.values) {
    const result: string[] = [];
    for (const item of v.arrayValue.values) {
      if (item.stringValue !== undefined) {
        result.push(item.stringValue);
      }
    }
    return result.length > 0 ? result : undefined;
  }
  return undefined;
}

// ── Structured convenience readers ──

export type SpanIdentity = {
  generationID?: string;
  sdkName?: string;
  operationName?: string;
  providerName?: string;
  conversationID?: string;
  agentName?: string;
  agentVersion?: string;
};

export function getIdentity(span: ConversationSpan): SpanIdentity {
  const a = span.attributes;
  return {
    generationID: getStringAttr(a, ATTR_GENERATION_ID),
    sdkName: getStringAttr(a, ATTR_SDK_NAME),
    operationName: getStringAttr(a, ATTR_OPERATION_NAME),
    providerName: getStringAttr(a, ATTR_PROVIDER_NAME),
    conversationID: getStringAttr(a, ATTR_CONVERSATION_ID),
    agentName: getStringAttr(a, ATTR_AGENT_NAME),
    agentVersion: getStringAttr(a, ATTR_AGENT_VERSION),
  };
}

export type SpanRequest = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  toolChoice?: string;
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
  thinkingLevel?: string;
  encodingFormats?: string[];
};

export function getRequest(span: ConversationSpan): SpanRequest {
  const a = span.attributes;
  return {
    model: getStringAttr(a, ATTR_REQUEST_MODEL),
    maxTokens: getIntAttr(a, ATTR_REQUEST_MAX_TOKENS),
    temperature: getFloatAttr(a, ATTR_REQUEST_TEMPERATURE),
    topP: getFloatAttr(a, ATTR_REQUEST_TOP_P),
    toolChoice: getStringAttr(a, ATTR_REQUEST_TOOL_CHOICE),
    thinkingEnabled: getBoolAttr(a, ATTR_REQUEST_THINKING_ENABLED),
    thinkingBudgetTokens: getIntAttr(a, ATTR_REQUEST_THINKING_BUDGET),
    thinkingLevel: getStringAttr(a, ATTR_REQUEST_THINKING_LEVEL),
    encodingFormats: getStringArrayAttr(a, ATTR_REQUEST_ENCODING_FORMATS),
  };
}

export type SpanResponse = {
  id?: string;
  model?: string;
  finishReasons?: string[];
};

export function getResponse(span: ConversationSpan): SpanResponse {
  const a = span.attributes;
  return {
    id: getStringAttr(a, ATTR_RESPONSE_ID),
    model: getStringAttr(a, ATTR_RESPONSE_MODEL),
    finishReasons: getStringArrayAttr(a, ATTR_RESPONSE_FINISH_REASONS),
  };
}

export type SpanTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
  toolUsePromptTokens?: number;
  serverToolUseWebSearch?: number;
  serverToolUseWebFetch?: number;
  serverToolUseTotal?: number;
};

export function getTokenUsage(span: ConversationSpan): SpanTokenUsage {
  const a = span.attributes;
  return {
    inputTokens: getIntAttr(a, ATTR_USAGE_INPUT_TOKENS),
    outputTokens: getIntAttr(a, ATTR_USAGE_OUTPUT_TOKENS),
    cacheReadTokens: getIntAttr(a, ATTR_USAGE_CACHE_READ_TOKENS),
    cacheWriteTokens: getIntAttr(a, ATTR_USAGE_CACHE_WRITE_TOKENS),
    cacheCreationTokens: getIntAttr(a, ATTR_USAGE_CACHE_CREATION_TOKENS),
    reasoningTokens: getIntAttr(a, ATTR_USAGE_REASONING_TOKENS),
    toolUsePromptTokens: getIntAttr(a, ATTR_USAGE_TOOL_USE_PROMPT_TOKENS),
    serverToolUseWebSearch: getIntAttr(a, ATTR_USAGE_SERVER_TOOL_USE_WEB_SEARCH),
    serverToolUseWebFetch: getIntAttr(a, ATTR_USAGE_SERVER_TOOL_USE_WEB_FETCH),
    serverToolUseTotal: getIntAttr(a, ATTR_USAGE_SERVER_TOOL_USE_TOTAL),
  };
}

export type SpanToolInfo = {
  name?: string;
  callID?: string;
  type?: string;
  description?: string;
  arguments?: string;
  result?: string;
};

export function getToolInfo(span: ConversationSpan): SpanToolInfo {
  const a = span.attributes;
  return {
    name: getStringAttr(a, ATTR_TOOL_NAME),
    callID: getStringAttr(a, ATTR_TOOL_CALL_ID),
    type: getStringAttr(a, ATTR_TOOL_TYPE),
    description: getStringAttr(a, ATTR_TOOL_DESCRIPTION),
    arguments: getStringAttr(a, ATTR_TOOL_CALL_ARGUMENTS),
    result: getStringAttr(a, ATTR_TOOL_CALL_RESULT),
  };
}

export type SpanEmbeddingInfo = {
  inputCount?: number;
  inputTexts?: string[];
  dimensionCount?: number;
  encodingFormats?: string[];
};

export function getEmbeddingInfo(span: ConversationSpan): SpanEmbeddingInfo {
  const a = span.attributes;
  return {
    inputCount: getIntAttr(a, ATTR_EMBEDDINGS_INPUT_COUNT),
    inputTexts: getStringArrayAttr(a, ATTR_EMBEDDINGS_INPUT_TEXTS),
    dimensionCount: getIntAttr(a, ATTR_EMBEDDINGS_DIMENSION_COUNT),
    encodingFormats: getStringArrayAttr(a, ATTR_REQUEST_ENCODING_FORMATS),
  };
}

export type SpanErrorInfo = {
  type?: string;
  category?: string;
};

export function getErrorInfo(span: ConversationSpan): SpanErrorInfo {
  const a = span.attributes;
  return {
    type: getStringAttr(a, ATTR_ERROR_TYPE),
    category: getStringAttr(a, ATTR_ERROR_CATEGORY),
  };
}

export type SpanFrameworkInfo = {
  name?: string;
  source?: string;
  language?: string;
  runID?: string;
  threadID?: string;
  parentRunID?: string;
  componentName?: string;
  runType?: string;
  retryAttempt?: number;
  langgraphNode?: string;
  eventID?: string;
  tags?: string[];
  stepType?: string;
  reasoningText?: string;
};

export function getFrameworkInfo(span: ConversationSpan): SpanFrameworkInfo {
  const a = span.attributes;
  return {
    name: getStringAttr(a, ATTR_FRAMEWORK_NAME),
    source: getStringAttr(a, ATTR_FRAMEWORK_SOURCE),
    language: getStringAttr(a, ATTR_FRAMEWORK_LANGUAGE),
    runID: getStringAttr(a, ATTR_FRAMEWORK_RUN_ID),
    threadID: getStringAttr(a, ATTR_FRAMEWORK_THREAD_ID),
    parentRunID: getStringAttr(a, ATTR_FRAMEWORK_PARENT_RUN_ID),
    componentName: getStringAttr(a, ATTR_FRAMEWORK_COMPONENT_NAME),
    runType: getStringAttr(a, ATTR_FRAMEWORK_RUN_TYPE),
    retryAttempt: getIntAttr(a, ATTR_FRAMEWORK_RETRY_ATTEMPT),
    langgraphNode: getStringAttr(a, ATTR_FRAMEWORK_LANGGRAPH_NODE),
    eventID: getStringAttr(a, ATTR_FRAMEWORK_EVENT_ID),
    tags: getStringArrayAttr(a, ATTR_FRAMEWORK_TAGS),
    stepType: getStringAttr(a, ATTR_FRAMEWORK_STEP_TYPE),
    reasoningText: getStringAttr(a, ATTR_FRAMEWORK_REASONING_TEXT),
  };
}
