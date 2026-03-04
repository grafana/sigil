import {
  CLAUDE_CODE_PROMPT_FILENAME,
  COPILOT_PROMPT_FILENAME,
  CURSOR_PROMPT_FILENAME,
  claudeCodeInstrumentationPrompt,
  copilotInstrumentationPrompt,
  cursorInstrumentationPrompt,
  getInstrumentationPrompt,
  getInstrumentationPromptFilename,
} from './cursorInstrumentationPrompt';

describe('cursorInstrumentationPrompt content mapping', () => {
  it('returns the right prompt for each IDE', () => {
    expect(getInstrumentationPrompt('cursor')).toBe(cursorInstrumentationPrompt);
    expect(getInstrumentationPrompt('claudecode')).toBe(claudeCodeInstrumentationPrompt);
    expect(getInstrumentationPrompt('copilot')).toBe(copilotInstrumentationPrompt);
  });

  it('returns the right filename for each IDE', () => {
    expect(getInstrumentationPromptFilename('cursor')).toBe(CURSOR_PROMPT_FILENAME);
    expect(getInstrumentationPromptFilename('claudecode')).toBe(CLAUDE_CODE_PROMPT_FILENAME);
    expect(getInstrumentationPromptFilename('copilot')).toBe(COPILOT_PROMPT_FILENAME);
  });

  it('includes IDE-specific preambles', () => {
    expect(cursorInstrumentationPrompt).toContain('Cursor Prompt: Sigil Instrumentation');
    expect(claudeCodeInstrumentationPrompt).toContain('Claude Code Prompt: Sigil Instrumentation');
    expect(copilotInstrumentationPrompt).toContain('GitHub Copilot Prompt: Sigil Instrumentation');
  });

  it('keeps prompts distinct across IDEs', () => {
    expect(cursorInstrumentationPrompt).not.toBe(claudeCodeInstrumentationPrompt);
    expect(cursorInstrumentationPrompt).not.toBe(copilotInstrumentationPrompt);
    expect(claudeCodeInstrumentationPrompt).not.toBe(copilotInstrumentationPrompt);
  });
});
