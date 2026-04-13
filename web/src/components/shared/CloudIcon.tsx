interface CloudIconProps {
  cloud: string;
  className?: string;
}

const cloudMap: Record<string, { icon: string; color: string; label: string }> = {
  aws:     { icon: 'fa-brands fa-aws',       color: '#ff9900', label: 'AWS' },
  gcp:     { icon: 'fa-brands fa-google',    color: '#4285f4', label: 'Google Cloud' },
  azure:   { icon: 'fa-brands fa-microsoft', color: '#0078d4', label: 'Azure' },
  hetzner: { icon: 'fa-solid fa-server',     color: '#d50c2d', label: 'Hetzner' },
};

const fallback = { icon: 'fa-solid fa-cloud', color: '#64748b', label: 'Cloud' };

export function CloudIcon({ cloud, className }: CloudIconProps) {
  const c = cloudMap[cloud.toLowerCase()] ?? fallback;
  return <i className={`${c.icon} ${className ?? ''}`} style={{ color: c.color }} title={c.label} />;
}

export function cloudLabel(cloud: string): string {
  return (cloudMap[cloud.toLowerCase()] ?? fallback).label;
}
