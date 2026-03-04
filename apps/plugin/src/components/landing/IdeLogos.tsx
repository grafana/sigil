import React from 'react';

type LogoProps = {
  size?: number;
  withBackground?: boolean;
};

export function CursorLogo({ size = 28, withBackground = true }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" role="img" aria-label="Cursor logo">
      {withBackground ? (
        <>
          <rect x="1.5" y="1.5" width="25" height="25" rx="7" fill="#111217" stroke="#2E3440" />
          <path d="M14 6L21 14L14 22L7 14L14 6Z" fill="#F9FAFC" />
          <path d="M14 9.8L18.2 14L14 18.2L9.8 14L14 9.8Z" fill="#111217" />
        </>
      ) : (
        <>
          <path d="M14 6L21 14L14 22L7 14L14 6Z" fill="currentColor" />
          <path d="M14 9.8L18.2 14L14 18.2L9.8 14L14 9.8Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </>
      )}
    </svg>
  );
}

export function ClaudeCodeLogo({ size = 28 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" role="img" aria-label="Claude Code logo">
      <rect x="1.5" y="1.5" width="25" height="25" rx="7" fill="#2A1F42" stroke="#5E4B8A" />
      <circle cx="14" cy="14" r="7.5" fill="#A78BFA" />
      <path
        d="M12 10.8C10.2 10.8 8.8 12.2 8.8 14C8.8 15.8 10.2 17.2 12 17.2"
        fill="none"
        stroke="#2A1F42"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16 10.8C17.8 10.8 19.2 12.2 19.2 14C19.2 15.8 17.8 17.2 16 17.2"
        fill="none"
        stroke="#2A1F42"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CopilotLogo({ size = 28 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" role="img" aria-label="Copilot logo">
      <defs>
        <linearGradient id="copilotGradient" x1="5" y1="4" x2="23" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#73B7FF" />
          <stop offset="1" stopColor="#3B82F6" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="25" height="25" rx="7" fill="#0D2340" stroke="#1F4E8C" />
      <path
        d="M8.5 15C8.5 11.9 11 9.4 14 9.4C17 9.4 19.5 11.9 19.5 15V16.3C19.5 18.2 17.9 19.8 16 19.8H12C10.1 19.8 8.5 18.2 8.5 16.3V15Z"
        fill="url(#copilotGradient)"
      />
      <circle cx="12.1" cy="14.8" r="1.05" fill="#0D2340" />
      <circle cx="15.9" cy="14.8" r="1.05" fill="#0D2340" />
    </svg>
  );
}
