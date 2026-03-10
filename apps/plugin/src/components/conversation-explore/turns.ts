import type { GenerationDetail, Message, Part } from '../../generation/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ConversationTurn = {
  readonly number: number;
  readonly messages: readonly Message[];
  readonly generationId?: string;
  /** True when the context this turn received diverges from the previous generation's output. */
  readonly prefixBreak?: boolean;
};

export type TurnHistory = {
  readonly turns: readonly ConversationTurn[];
  readonly totalTurns: number;
};

// ---------------------------------------------------------------------------
// Message equality (value comparison)
// ---------------------------------------------------------------------------

function partsEqual(left: Part, right: Part): boolean {
  return (
    (left.text ?? '') === (right.text ?? '') &&
    (left.thinking ?? '') === (right.thinking ?? '') &&
    (left.metadata?.provider_type ?? '') === (right.metadata?.provider_type ?? '') &&
    (left.tool_call?.id ?? '') === (right.tool_call?.id ?? '') &&
    (left.tool_call?.name ?? '') === (right.tool_call?.name ?? '') &&
    (left.tool_result?.tool_call_id ?? '') === (right.tool_result?.tool_call_id ?? '') &&
    (left.tool_result?.name ?? '') === (right.tool_result?.name ?? '') &&
    Boolean(left.tool_result?.is_error) === Boolean(right.tool_result?.is_error)
  );
}

export function messagesEqual(left: Message, right: Message): boolean {
  if (left.role !== right.role || (left.name ?? '') !== (right.name ?? '') || left.parts.length !== right.parts.length) {
    return false;
  }
  for (let idx = 0; idx < left.parts.length; idx++) {
    if (!partsEqual(left.parts[idx], right.parts[idx])) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sortGenerationsByCreatedAt(generations: readonly GenerationDetail[]): GenerationDetail[] {
  return [...generations].sort((left, right) => {
    const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
    const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
    return leftTime - rightTime;
  });
}

function generationTranscript(generation: GenerationDetail): readonly Message[] {
  return [...(generation.input ?? []), ...(generation.output ?? [])];
}

function sharedPrefixLength(a: readonly Message[], b: readonly Message[]): number {
  const max = Math.min(a.length, b.length);
  let count = 0;
  while (count < max && messagesEqual(a[count], b[count])) {
    count++;
  }
  return count;
}

function normalizedAgentName(gen: GenerationDetail): string {
  return gen.agent_name?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// Role-based fallback: group messages by USER-starts-a-turn rule
// ---------------------------------------------------------------------------

function groupByRole(messages: readonly Message[]): ConversationTurn[] {
  if (messages.length === 0) {
    return [];
  }

  const turns: ConversationTurn[] = [];
  let current: Message[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === 'MESSAGE_ROLE_USER') {
      turns.push({ number: turns.length + 1, messages: current });
      current = [messages[i]];
    } else {
      current.push(messages[i]);
    }
  }
  turns.push({ number: turns.length + 1, messages: current });

  return turns;
}

// ---------------------------------------------------------------------------
// Chain-based reconstruction: diff consecutive generation transcripts
// ---------------------------------------------------------------------------

function buildAgentChain(
  currentGeneration: GenerationDetail,
  allGenerations: readonly GenerationDetail[]
): GenerationDetail[] {
  const agent = normalizedAgentName(currentGeneration);
  const candidates = allGenerations.filter(
    (g) => normalizedAgentName(g) === agent && g.generation_id !== currentGeneration.generation_id
  );

  const chain: GenerationDetail[] = [currentGeneration];
  let cursor = currentGeneration;

  while (true) {
    const cursorInput = cursor.input ?? [];
    if (cursorInput.length === 0) {
      break;
    }

    let bestMatch: GenerationDetail | null = null;
    let bestCoverage = 0;

    for (const candidate of candidates) {
      if (chain.includes(candidate)) {
        continue;
      }
      if ((candidate.input ?? []).length >= cursorInput.length) {
        continue;
      }
      const transcript = generationTranscript(candidate);
      const coverage = sharedPrefixLength(transcript, cursorInput);
      if (coverage > bestCoverage) {
        bestCoverage = coverage;
        bestMatch = candidate;
      }
    }

    if (!bestMatch || bestCoverage === 0) {
      break;
    }
    chain.unshift(bestMatch);
    cursor = bestMatch;
  }

  return chain;
}

function reconstructFromChain(
  chain: readonly GenerationDetail[],
  inputMessages: readonly Message[]
): ConversationTurn[] | null {
  if (chain.length < 2 || inputMessages.length === 0) {
    return null;
  }

  const turns: ConversationTurn[] = [];
  let coveredUpTo = 0;
  let prevOutputMismatch = false;

  for (let i = 0; i < chain.length; i++) {
    const gen = chain[i];
    const isLast = i === chain.length - 1;

    const transcript = generationTranscript(gen);
    const transcriptCoverage = sharedPrefixLength(transcript, inputMessages);
    const inputOnlyCoverage = sharedPrefixLength(gen.input ?? [], inputMessages);
    const coverage = Math.max(transcriptCoverage, inputOnlyCoverage);

    const hasOutput = (gen.output?.length ?? 0) > 0;
    const outputMismatch = hasOutput && transcriptCoverage === inputOnlyCoverage;

    const turnEnd = isLast ? inputMessages.length : Math.max(coverage, coveredUpTo);

    if (turnEnd > coveredUpTo) {
      turns.push({
        number: turns.length + 1,
        messages: inputMessages.slice(coveredUpTo, turnEnd),
        generationId: gen.generation_id,
        prefixBreak: prevOutputMismatch || undefined,
      });
    }

    prevOutputMismatch = outputMismatch;
    coveredUpTo = Math.max(coveredUpTo, coverage);
  }

  if (coveredUpTo === 0 && chain.length > 1) {
    return null;
  }

  return splitMultiUserTurns(turns);
}

function splitMultiUserTurns(turns: ConversationTurn[]): ConversationTurn[] {
  const result: ConversationTurn[] = [];

  for (const turn of turns) {
    let userCount = 0;
    for (const msg of turn.messages) {
      if (msg.role === 'MESSAGE_ROLE_USER') {
        userCount++;
      }
    }
    if (userCount <= 1) {
      result.push(turn);
      continue;
    }
    const subTurns = groupByRole(turn.messages);
    for (let si = 0; si < subTurns.length; si++) {
      result.push({
        ...subTurns[si],
        generationId: turn.generationId,
        prefixBreak: si === 0 ? turn.prefixBreak : undefined,
      });
    }
  }

  // Renumber
  return result.map((t, i) => ({ ...t, number: i + 1 }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reconstructs conversation turns from the current generation's input
 * and all available generation history.
 *
 * Strategy:
 * 1. Filter to generations from the same agent (by agent_name).
 * 2. If cumulative generation history is available, diff consecutive
 *    transcripts to identify exact turn boundaries.
 * 3. Otherwise, fall back to role-based grouping (each USER message
 *    starts a new turn).
 */
export function reconstructTurns(
  inputMessages: readonly Message[],
  currentGeneration: GenerationDetail,
  allGenerations: readonly GenerationDetail[]
): TurnHistory {
  if (inputMessages.length === 0) {
    return { turns: [], totalTurns: 0 };
  }

  const chain = buildAgentChain(currentGeneration, allGenerations);

  if (chain.length >= 2) {
    const turns = reconstructFromChain(chain, inputMessages);
    if (turns !== null && turns.length > 0) {
      return { turns, totalTurns: turns.length };
    }
  }

  const turns = groupByRole(inputMessages);
  return { turns, totalTurns: turns.length };
}

/**
 * Returns the messages that are new in `gen` compared to the previous
 * generation's transcript. Used by ChatThread to avoid repeating context.
 */
export function newMessagesForGeneration(
  gen: GenerationDetail,
  previousGen: GenerationDetail | undefined
): readonly Message[] {
  const input = gen.input ?? [];
  if (input.length === 0) {
    return [];
  }
  if (!previousGen) {
    return input;
  }

  const prevTranscript = generationTranscript(previousGen);
  if (prevTranscript.length === 0) {
    return input;
  }

  const prefix = sharedPrefixLength(prevTranscript, input);
  if (prefix > 0 && prefix < input.length) {
    return input.slice(prefix);
  }

  // No prefix match -- return just the latest user turn as a safe default.
  for (let i = input.length - 1; i >= 0; i--) {
    if (input[i].role === 'MESSAGE_ROLE_ASSISTANT') {
      return i < input.length - 1 ? input.slice(i + 1) : [input[input.length - 1]];
    }
  }
  return [input[input.length - 1]];
}
