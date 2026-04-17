import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusPulse } from '../StatusPulse';

describe('StatusPulse', () => {
  it('renders an SVG element', () => {
    const { container } = render(<StatusPulse status="online" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders animation for online status', () => {
    const { container } = render(<StatusPulse status="online" />);
    const animates = container.querySelectorAll('animate');
    expect(animates.length).toBeGreaterThan(0);
  });

  it('renders no animation for offline status', () => {
    const { container } = render(<StatusPulse status="offline" />);
    const animates = container.querySelectorAll('animate');
    expect(animates.length).toBe(0);
  });

  it('renders animation for warning status', () => {
    const { container } = render(<StatusPulse status="warning" />);
    const animates = container.querySelectorAll('animate');
    expect(animates.length).toBeGreaterThan(0);
  });

  it('respects custom size', () => {
    const { container } = render(<StatusPulse status="online" size={20} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
  });

  it('uses green color for online', () => {
    const { container } = render(<StatusPulse status="online" />);
    const circle = container.querySelector('circle');
    expect(circle?.getAttribute('fill')).toBe('#22c55e');
  });

  it('uses gray color for offline', () => {
    const { container } = render(<StatusPulse status="offline" />);
    const circle = container.querySelector('circle');
    expect(circle?.getAttribute('fill')).toBe('#64748b');
  });
});
