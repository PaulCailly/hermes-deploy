import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatCard } from '../StatCard';

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard icon="fa-solid fa-comments" label="Sessions" value="1,247" />);
    expect(screen.getByText('Sessions')).toBeTruthy();
    expect(screen.getByText('1,247')).toBeTruthy();
  });

  it('renders sub text when provided', () => {
    render(<StatCard icon="fa-solid fa-comments" label="Sessions" value="1,247" sub="23 today" />);
    expect(screen.getByText('23 today')).toBeTruthy();
  });

  it('does not render sub text when not provided', () => {
    const { container } = render(<StatCard icon="fa-solid fa-comments" label="Sessions" value="1,247" />);
    const subElements = container.querySelectorAll('.text-\\[11px\\].mt-0\\.5');
    expect(subElements.length).toBe(0);
  });

  it('renders the icon', () => {
    const { container } = render(<StatCard icon="fa-solid fa-comments" label="Sessions" value="100" />);
    const icon = container.querySelector('.fa-comments');
    expect(icon).toBeTruthy();
  });
});
