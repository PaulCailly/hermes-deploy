interface PlatformIconProps {
  platform: string;
  className?: string;
}

const platformMap: Record<string, { icon: string; color: string; label: string }> = {
  telegram:  { icon: 'fa-brands fa-telegram',    color: '#26a5e4', label: 'Telegram' },
  slack:     { icon: 'fa-brands fa-slack',        color: '#e01e5a', label: 'Slack' },
  discord:   { icon: 'fa-brands fa-discord',      color: '#5865f2', label: 'Discord' },
  whatsapp:  { icon: 'fa-brands fa-whatsapp',     color: '#25d366', label: 'WhatsApp' },
  signal:    { icon: 'fa-solid fa-comment-dots',   color: '#3a76f0', label: 'Signal' },
  email:     { icon: 'fa-solid fa-envelope',       color: '#94a3b8', label: 'Email' },
  webhook:   { icon: 'fa-solid fa-globe',          color: '#94a3b8', label: 'Webhook' },
  matrix:    { icon: 'fa-solid fa-hashtag',        color: '#0dbd8b', label: 'Matrix' },
  cli:       { icon: 'fa-solid fa-terminal',       color: '#94a3b8', label: 'CLI' },
  cron:      { icon: 'fa-solid fa-clock',          color: '#8b5cf6', label: 'Cron' },
};

const fallback = { icon: 'fa-solid fa-circle-question', color: '#64748b', label: 'Unknown' };

export function PlatformIcon({ platform, className }: PlatformIconProps) {
  const p = platformMap[platform.toLowerCase()] ?? fallback;
  return <i className={`${p.icon} ${className ?? ''}`} style={{ color: p.color }} title={p.label} />;
}

export function platformLabel(platform: string): string {
  return (platformMap[platform.toLowerCase()] ?? fallback).label;
}
