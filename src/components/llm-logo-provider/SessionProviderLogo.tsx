import { useTheme } from '../../contexts/ThemeContext';
import type { LLMProvider } from '../../types/app';
import OpenCodeLogo from './OpenCodeLogo';

type SessionProviderLogoProps = {
  provider?: LLMProvider | string | null;
  className?: string;
};

type LogoConfig = { light: string; dark: string; alt: string };

const LOGO_MAP: Record<LLMProvider, LogoConfig> = {
  claude: { light: '/icons/claude-ai-icon.svg', dark: '/icons/claude-ai-icon.svg', alt: 'Claude' },
  gemini: { light: '/icons/gemini-ai-icon.svg', dark: '/icons/gemini-ai-icon.svg', alt: 'Gemini' },
  codex:  { light: '/icons/codex.svg',          dark: '/icons/codex-white.svg',    alt: 'Codex'  },
  cursor: { light: '/icons/cursor.svg',          dark: '/icons/cursor-white.svg',   alt: 'Cursor' },
};

export default function SessionProviderLogo({ provider = 'claude', className = 'w-5 h-5' }: SessionProviderLogoProps) {
  const { isDarkMode } = useTheme();
  if (provider === 'opencode') {
    return <OpenCodeLogo className={className} />;
  }
  const logo = LOGO_MAP[provider as LLMProvider] ?? LOGO_MAP.claude;
  return <img src={isDarkMode ? logo.dark : logo.light} alt={logo.alt} className={className} />;
}
