import React from 'react';
import anthropicLogo from '../../img/ide-logos/anthropic.svg';
import copilotLogo from '../../img/ide-logos/githubcopilot.svg';
import cursorLogo from '../../img/ide-logos/cursor.svg';

type LogoProps = {
  size?: number;
  withBackground?: boolean;
};

type MaskLogoProps = {
  size: number;
  src: string;
  label: string;
};

function MaskLogo({ size, src, label }: MaskLogoProps) {
  return (
    <span
      role="img"
      aria-label={label}
      style={{
        width: size,
        height: size,
        display: 'inline-block',
        backgroundColor: 'currentColor',
        maskImage: `url(${src})`,
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        maskSize: 'contain',
        WebkitMaskImage: `url(${src})`,
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        WebkitMaskSize: 'contain',
      }}
    />
  );
}

export function CursorLogo({ size = 28, withBackground: _withBackground = true }: LogoProps) {
  return <MaskLogo size={size} src={cursorLogo} label="Cursor logo" />;
}

export function ClaudeCodeLogo({ size = 28 }: LogoProps) {
  return <MaskLogo size={size} src={anthropicLogo} label="Claude Code logo" />;
}

export function CopilotLogo({ size = 28 }: LogoProps) {
  return <MaskLogo size={size} src={copilotLogo} label="Copilot logo" />;
}
