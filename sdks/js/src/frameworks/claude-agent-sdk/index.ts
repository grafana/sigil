export { withSigilClaudeAgentSdk, interceptPrompt } from './wrapper.js';
export type { WithSigilResult } from './wrapper.js';
export { SigilClaudeAgentSdkHandler } from './handler.js';
export type { FrameworkHandlerOptions, SigilClientLike } from './handler.js';
export {
  mapBetaMessageToGenerationResult,
  mapUsage,
  extractToolUseBlocks,
  extractMessageLevelError,
} from './mapper.js';
export type { GenerationResultLike } from './mapper.js';

import { SigilClaudeAgentSdkHandler } from './handler.js';
import type { SigilClientLike, FrameworkHandlerOptions } from './handler.js';

export function createSigilClaudeAgentSdk(
  client: SigilClientLike,
  options: FrameworkHandlerOptions = {},
): SigilClaudeAgentSdkHandler {
  return new SigilClaudeAgentSdkHandler(client, options);
}
