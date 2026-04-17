import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PlatformIcon, platformLabel } from '../PlatformIcon';

describe('PlatformIcon', () => {
  it('renders telegram brand icon', () => {
    const { container } = render(<PlatformIcon platform="telegram" />);
    const icon = container.querySelector('i');
    expect(icon?.className).toContain('fa-telegram');
  });

  it('renders slack brand icon', () => {
    const { container } = render(<PlatformIcon platform="slack" />);
    const icon = container.querySelector('i');
    expect(icon?.className).toContain('fa-slack');
  });

  it('renders fallback for unknown platform', () => {
    const { container } = render(<PlatformIcon platform="foobar" />);
    const icon = container.querySelector('i');
    expect(icon?.className).toContain('fa-circle-question');
  });

  it('is case-insensitive', () => {
    const { container } = render(<PlatformIcon platform="TELEGRAM" />);
    const icon = container.querySelector('i');
    expect(icon?.className).toContain('fa-telegram');
  });

  it('applies custom className', () => {
    const { container } = render(<PlatformIcon platform="telegram" className="text-lg" />);
    const icon = container.querySelector('i');
    expect(icon?.className).toContain('text-lg');
  });
});

describe('platformLabel', () => {
  it('returns display name for known platforms', () => {
    expect(platformLabel('telegram')).toBe('Telegram');
    expect(platformLabel('slack')).toBe('Slack');
    expect(platformLabel('cli')).toBe('CLI');
  });

  it('returns Unknown for unknown platforms', () => {
    expect(platformLabel('foobar')).toBe('Unknown');
  });
});
