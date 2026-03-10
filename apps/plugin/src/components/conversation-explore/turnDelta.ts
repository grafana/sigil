import type { GenerationDetail, Message, Part } from '../../generation/types';

function partsEqual(left: Part, right: Part): boolean {
  return (
    (left.text ?? '') === (right.text ?? '') &&
    (left.thinking ?? '') === (right.thinking ?? '') &&
    (left.metadata?.provider_type ?? '') === (right.metadata?.provider_type ?? '') &&
    (left.tool_call?.id ?? '') === (right.tool_call?.id ?? '') &&
    (left.tool_call?.name ?? '') === (right.tool_call?.name ?? '') &&
    (left.tool_call?.input_json ?? '') === (right.tool_call?.input_json ?? '') &&
    (left.tool_result?.tool_call_id ?? '') === (right.tool_result?.tool_call_id ?? '') &&
    (left.tool_result?.name ?? '') === (right.tool_result?.name ?? '') &&
    (left.tool_result?.content ?? '') === (right.tool_result?.content ?? '') &&
    (left.tool_result?.content_json ?? '') === (right.tool_result?.content_json ?? '') &&
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

export function sortGenerationsByCreatedAt(generations: GenerationDetail[]): GenerationDetail[] {
  return [...generations].sort((left, right) => {
    const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
    const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
    return leftTime - rightTime;
  });
}

export function generationTranscript(generation: GenerationDetail | undefined): Message[] {
  if (!generation) {
    return [];
  }
  return [...(generation.input ?? []), ...(generation.output ?? [])];
}

function sharedPrefixLength(previousTranscript: Message[], currentInput: Message[]): number {
  const maxLength = Math.min(previousTranscript.length, currentInput.length);
  let count = 0;
  while (count < maxLength && messagesEqual(previousTranscript[count], currentInput[count])) {
    count++;
  }
  return count;
}

function suffixPrefixOverlapLength(previousTranscript: Message[], currentInput: Message[]): number {
  const maxLength = Math.min(previousTranscript.length, currentInput.length);

  for (let overlap = maxLength; overlap > 0; overlap--) {
    let matches = true;
    for (let idx = 0; idx < overlap; idx++) {
      if (!messagesEqual(previousTranscript[previousTranscript.length - overlap + idx], currentInput[idx])) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return overlap;
    }
  }

  return 0;
}

function latestInputTurn(inputMessages: Message[]): Message[] {
  if (inputMessages.length === 0) {
    return [];
  }

  let lastAssistantIndex = -1;
  for (let idx = inputMessages.length - 1; idx >= 0; idx--) {
    if (inputMessages[idx].role === 'MESSAGE_ROLE_ASSISTANT') {
      lastAssistantIndex = idx;
      break;
    }
  }

  if (lastAssistantIndex >= 0 && lastAssistantIndex < inputMessages.length - 1) {
    return inputMessages.slice(lastAssistantIndex + 1);
  }

  for (let idx = inputMessages.length - 1; idx >= 0; idx--) {
    if (inputMessages[idx].role !== 'MESSAGE_ROLE_ASSISTANT') {
      return [inputMessages[idx]];
    }
  }

  return [inputMessages[inputMessages.length - 1]];
}

export function getDisplayedInputMessages(
  inputMessages: Message[],
  previousGeneration: GenerationDetail | undefined
): Message[] {
  if (inputMessages.length === 0) {
    return [];
  }
  if (!previousGeneration) {
    return inputMessages;
  }

  const previousTranscript = generationTranscript(previousGeneration);
  if (previousTranscript.length === 0) {
    return inputMessages;
  }

  const prefixLength = sharedPrefixLength(previousTranscript, inputMessages);
  if (prefixLength > 0 && prefixLength < inputMessages.length) {
    return inputMessages.slice(prefixLength);
  }

  const overlapLength = suffixPrefixOverlapLength(previousTranscript, inputMessages);
  if (overlapLength > 0 && overlapLength < inputMessages.length) {
    return inputMessages.slice(overlapLength);
  }

  return latestInputTurn(inputMessages);
}
