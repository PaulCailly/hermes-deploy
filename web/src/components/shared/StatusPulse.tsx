interface StatusPulseProps {
  status: 'online' | 'offline' | 'warning';
  size?: number;
}

const colors = {
  online: '#22c55e',
  offline: '#64748b',
  warning: '#f59e0b',
};

export function StatusPulse({ status, size = 10 }: StatusPulseProps) {
  const color = colors[status];
  const r = size * 0.35;
  const cx = size / 2;
  const cy = size / 2;

  if (status === 'offline') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
        <circle cx={cx} cy={cy} r={r} fill={color} />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      <circle cx={cx} cy={cy} r={r} fill={color}>
        <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="1" opacity="0.3">
        <animate attributeName="r" values={`${r};${r * 1.6};${r}`} dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
