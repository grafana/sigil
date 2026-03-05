import React from 'react';
import type { InstrumentationPromptIde } from '../content/cursorInstrumentationPrompt';
import { ClaudeCodeLogo, CopilotLogo, CursorLogo } from '../components/landing/IdeLogos';

export type IdeTab = {
  key: InstrumentationPromptIde;
  label: string;
  logo: React.ReactNode;
  blurb: string;
  tips: string[];
};

export const ideTabs: IdeTab[] = [
  {
    key: 'cursor',
    label: 'Cursor',
    logo: <CursorLogo />,
    blurb: 'Have Cursor help add Sigil instrumentation to your code.',
    tips: [],
  },
  {
    key: 'claudecode',
    label: 'Claude Code',
    logo: <ClaudeCodeLogo />,
    blurb: 'Have Claude Code help add Sigil instrumentation to your code.',
    tips: [],
  },
  {
    key: 'copilot',
    label: 'Copilot',
    logo: <CopilotLogo />,
    blurb: 'Have Copilot help add Sigil instrumentation to your code.',
    tips: [],
  },
];

export function buildCursorPromptDeeplink(promptText: string): string {
  const deeplink = new URL('https://cursor.com/link/prompt');
  deeplink.searchParams.set('text', promptText);
  return deeplink.toString();
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function renderIdeActionLogo(ide: InstrumentationPromptIde): React.ReactNode {
  if (ide === 'cursor') {
    return <CursorLogo size={20} withBackground={false} />;
  }
  if (ide === 'claudecode') {
    return <ClaudeCodeLogo size={20} />;
  }
  return <CopilotLogo size={20} />;
}
