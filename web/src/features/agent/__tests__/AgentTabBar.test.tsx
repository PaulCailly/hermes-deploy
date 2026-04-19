import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AgentTabBar } from '../AgentTabBar';

describe('AgentTabBar', () => {
  it('renders all 11 tabs', () => {
    render(<AgentTabBar active="overview" onSelect={() => {}} />);
    const tabs = ['Overview', 'Sessions', 'Analytics', 'Skills', 'Cron', 'Gateway', 'Infra', 'Config', 'Logs', 'SSH', 'Secrets'];
    for (const tab of tabs) {
      expect(screen.getByText(tab)).toBeTruthy();
    }
  });

  it('highlights the active tab', () => {
    render(<AgentTabBar active="sessions" onSelect={() => {}} />);
    const sessionsTab = screen.getByText('Sessions');
    expect(sessionsTab.className).toContain('text-indigo-300');
    expect(sessionsTab.className).toContain('border-indigo-500');
  });

  it('calls onSelect when a tab is clicked', () => {
    const onSelect = vi.fn();
    render(<AgentTabBar active="overview" onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Logs'));
    expect(onSelect).toHaveBeenCalledWith('logs');
  });

  it('non-active tabs have muted styling', () => {
    render(<AgentTabBar active="overview" onSelect={() => {}} />);
    const configTab = screen.getByText('Config');
    expect(configTab.className).toContain('text-slate-500');
    expect(configTab.className).toContain('border-transparent');
  });
});
