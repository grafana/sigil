import {
  mapBetaMessageToGenerationResult,
  extractToolUseBlocks,
  extractToolResultBlocks,
  extractInputMessages,
  extractMessageLevelError,
  isRecord,
  asString,
} from './mapper.js';
import type {
  GenerationRecorder,
  GenerationStart,
  Message,
  ToolExecutionRecorder,
  ToolExecutionResult,
  ToolExecutionStart,
} from '../../types.js';
import type { SigilClient } from '../../client.js';

// ---------------------------------------------------------------------------
// Framework constants
// ---------------------------------------------------------------------------

const FRAMEWORK_TAGS: Record<string, string> = {
  'sigil.framework.name': 'claude-agent-sdk',
  'sigil.framework.source': 'handler',
  'sigil.framework.language': 'javascript',
};

// ---------------------------------------------------------------------------
// Interfaces for Sigil client dependencies
// ---------------------------------------------------------------------------

export type SigilClientLike = Pick<SigilClient, 'startStreamingGeneration' | 'startToolExecution'>;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface FrameworkHandlerOptions {
  agentName?: string;
  agentVersion?: string;
  /** Override provider name (default: 'anthropic'). */
  provider?: string;
  /** System prompt passed to query(). The Agent SDK doesn't expose this in the stream, so it must be provided here. */
  systemPrompt?: string;
  /** Initial user prompt. In single-message mode, the Agent SDK doesn't emit SDKUserMessage, so it must be provided here. */
  initialPrompt?: string;
  extraTags?: Record<string, string>;
  extraMetadata?: Record<string, unknown>;
  /** Whether to capture input messages in generation results. Default: true */
  captureInputs?: boolean;
  /** Whether to capture output content in generation results. Default: true */
  captureOutputs?: boolean;
  /** Override conversationId for all generations (e.g. a DAG run id for grouping). When set, takes precedence over the session_id from the SDK stream. */
  conversationId?: string;
}

// ---------------------------------------------------------------------------
// Result metadata shape
// ---------------------------------------------------------------------------

export interface ResultMetadata {
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  modelUsage?: Record<string, unknown>;
  subtype?: string;
}

// ---------------------------------------------------------------------------
// SDKMessage shapes (minimal, structural typing)
// ---------------------------------------------------------------------------

type AnyRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export class SigilClaudeAgentSdkHandler {
  private readonly client: SigilClientLike;
  private readonly options: FrameworkHandlerOptions;

  // Session context captured from system init
  private sessionId?: string;
  private sessionModel?: string;

  // TTFT: captured timestamp of first text_delta stream event
  private firstTokenAt?: Date;

  // Accumulated user/tool messages since last assistant turn (used as generation input)
  private pendingInputMessages: Message[] = [];

  // Pending tool execution recorders keyed by tool_use_id
  private pendingToolRecorders = new Map<string, ToolExecutionRecorder>();

  // Stored result metadata
  private resultMetadata?: ResultMetadata;

  // Earliest observed stream event for the current turn
  private observedGenerationStartedAt?: Date;

  constructor(client: SigilClientLike, options: FrameworkHandlerOptions = {}) {
    this.client = client;
    this.options = options;
    if (options.initialPrompt) {
      this.pendingInputMessages.push({ role: 'user', content: options.initialPrompt });
    }
  }

  // -------------------------------------------------------------------------
  // handleSystemInit
  // -------------------------------------------------------------------------

  handleSystemInit(msg: AnyRecord): void {
    if (msg.subtype !== 'init') return;
    this.sessionId = asString(msg.session_id) || undefined;
    this.sessionModel = asString(msg.model) || undefined;
  }

  // -------------------------------------------------------------------------
  // handleAssistantMessage
  // -------------------------------------------------------------------------

  handleAssistantMessage(msg: AnyRecord): void {
    const conversationId = this.options.conversationId ?? (asString(msg.session_id) || this.sessionId);
    const parentToolUseId = asString(msg.parent_tool_use_id) || undefined;

    // Grab the inner BetaMessage
    const betaMessage = isRecord(msg.message) ? (msg.message as AnyRecord) : {};
    const model = asString(betaMessage.model) || this.sessionModel;

    // Build tags
    const tags: Record<string, string> = {
      ...FRAMEWORK_TAGS,
      ...this.options.extraTags,
    };

    // Build metadata
    const metadata: AnyRecord = {
      ...this.options.extraMetadata,
    };
    if (parentToolUseId) {
      metadata.parent_tool_use_id = parentToolUseId;
    }

    // Capture pending input messages and reset for next turn
    const inputMessages = this.pendingInputMessages;
    this.pendingInputMessages = [];

    // Start streaming generation
    const startArg: GenerationStart = {
      model: {
        provider: this.options.provider ?? 'anthropic',
        name: model || 'unknown',
      },
      mode: 'STREAM',
      conversationId,
      tags,
      metadata,
      startedAt: this.observedGenerationStartedAt,
    };
    if (this.options.agentName !== undefined) startArg.agentName = this.options.agentName;
    if (this.options.agentVersion !== undefined) startArg.agentVersion = this.options.agentVersion;
    if (this.options.systemPrompt) startArg.systemPrompt = this.options.systemPrompt;

    const recorder = this.client.startStreamingGeneration(startArg);
    this.observedGenerationStartedAt = undefined;

    // Apply TTFT if we captured a stream event before this message
    const ttft = this.firstTokenAt;
    this.firstTokenAt = undefined; // consume it
    if (ttft) {
      recorder.setFirstTokenAt(ttft);
    }

    // Handle error vs normal result.
    // SDKAssistantMessageError is a string enum: 'authentication_failed' | 'billing_error' |
    // 'rate_limit' | 'invalid_request' | 'server_error' | 'unknown'
    const messageLevelError = extractMessageLevelError(betaMessage);
    if (typeof msg.error === 'string' && msg.error.length > 0) {
      recorder.setCallError(msg.error);
    } else if (messageLevelError !== undefined) {
      recorder.setCallError(messageLevelError);
    } else {
      const captureOutputs = this.options.captureOutputs !== false;
      const captureInputs = this.options.captureInputs !== false;
      const result = captureOutputs
        ? mapBetaMessageToGenerationResult(betaMessage)
        : mapBetaMessageToGenerationResult({ ...betaMessage, content: [] });
      if (captureInputs && inputMessages.length > 0) {
        result.input = inputMessages;
      }
      recorder.setResult(result);
    }

    recorder.end();

    // Record pending tool executions for any tool_use blocks in the content
    const toolUseBlocks = extractToolUseBlocks(betaMessage.content);
    for (const block of toolUseBlocks) {
      const toolStart: ToolExecutionStart = {
        toolName: block.name,
        toolCallId: block.id,
        conversationId,
        agentName: this.options.agentName,
        agentVersion: this.options.agentVersion,
        requestModel: model || undefined,
        requestProvider: this.options.provider ?? 'anthropic',
        includeContent: this.options.captureInputs !== false || this.options.captureOutputs !== false,
      };
      const toolRecorder = this.client.startToolExecution(toolStart);
      this.pendingToolRecorders.set(block.id, toolRecorder);
    }
  }

  // -------------------------------------------------------------------------
  // handleUserMessage
  // -------------------------------------------------------------------------

  handleUserMessage(msg: AnyRecord): void {
    const innerMessage = isRecord(msg.message) ? (msg.message as AnyRecord) : {};

    // Accumulate user message as input for the next generation
    if (this.options.captureInputs !== false) {
      this.pendingInputMessages.push(...extractInputMessages(innerMessage.content));
    }

    const toolResultBlocks = extractToolResultBlocks(innerMessage.content);

    for (const block of toolResultBlocks) {
      const recorder = this.pendingToolRecorders.get(block.tool_use_id);
      if (!recorder) continue;

      if (block.is_error) {
        recorder.setCallError(block.content ?? 'tool error');
      } else {
        const result: ToolExecutionResult = {
          result: block.rawContent,
        };
        recorder.setResult(result);
      }
      recorder.end();
      this.pendingToolRecorders.delete(block.tool_use_id);
    }
  }

  // -------------------------------------------------------------------------
  // handleStreamEvent
  // -------------------------------------------------------------------------

  handleStreamEvent(msg: AnyRecord): void {
    if (!this.observedGenerationStartedAt) {
      this.observedGenerationStartedAt = new Date();
    }

    if (!this.firstTokenAt) {
      const event = isRecord(msg.event) ? (msg.event as AnyRecord) : {};
      // content_block_delta with a text_delta sub-type
      if (event.type === 'content_block_delta') {
        const delta = isRecord(event.delta) ? (event.delta as AnyRecord) : {};
        if (delta.type === 'text_delta') {
          this.firstTokenAt = new Date();
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // handleResult
  // -------------------------------------------------------------------------

  handleResult(msg: AnyRecord): void {
    this.resultMetadata = {
      total_cost_usd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined,
      duration_ms: typeof msg.duration_ms === 'number' ? msg.duration_ms : undefined,
      num_turns: typeof msg.num_turns === 'number' ? msg.num_turns : undefined,
      modelUsage: isRecord(msg.modelUsage) ? (msg.modelUsage as Record<string, unknown>) : undefined,
      subtype: asString(msg.subtype) || undefined,
    };

    // Flush any pending tool recorders that haven't received a tool_result
    this.flushPendingToolRecorders();
    this.observedGenerationStartedAt = undefined;
    this.firstTokenAt = undefined;
  }

  // -------------------------------------------------------------------------
  // getResultMetadata
  // -------------------------------------------------------------------------

  getResultMetadata(): ResultMetadata | undefined {
    return this.resultMetadata;
  }

  /**
   * Add a user input message to the pending queue.
   * Called by interceptPrompt() when wrapping the streaming input generator.
   */
  addInputMessage(msg: Message): void {
    if (this.options.captureInputs !== false) {
      this.pendingInputMessages.push(msg);
    }
  }

  // -------------------------------------------------------------------------
  // cleanup
  // -------------------------------------------------------------------------

  cleanup(): void {
    this.flushPendingToolRecorders();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private flushPendingToolRecorders(): void {
    for (const [id, recorder] of this.pendingToolRecorders) {
      recorder.setCallError(new Error('tool execution did not complete before cleanup'));
      recorder.end();
      this.pendingToolRecorders.delete(id);
    }
  }
}
