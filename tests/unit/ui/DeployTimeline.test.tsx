import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { DeployTimeline } from '../../../src/ui/components/DeployTimeline.js';

describe('<DeployTimeline />', () => {
  it('renders pending phases with a neutral marker', () => {
    const { lastFrame } = render(
      <DeployTimeline
        phases={[
          { id: 'validate', label: 'Validating', status: 'pending' },
          { id: 'provision', label: 'Provisioning', status: 'pending' },
        ]}
        logLines={[]}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Validating');
    expect(frame).toContain('Provisioning');
    expect(frame).toContain('○');
  });

  it('renders a done phase with a checkmark', () => {
    const { lastFrame } = render(
      <DeployTimeline
        phases={[{ id: 'validate', label: 'Validating', status: 'done' }]}
        logLines={[]}
      />,
    );
    expect(lastFrame() ?? '').toContain('✓');
  });

  it('renders a failure state with the error message', () => {
    const { lastFrame } = render(
      <DeployTimeline
        phases={[
          { id: 'healthcheck', label: 'Healthcheck', status: 'failed', error: 'service is not active' },
        ]}
        logLines={[]}
        finalMessage="deploy failed"
        finalStatus="failure"
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('service is not active');
    expect(frame).toContain('deploy failed');
  });

  it('shows the last 10 log lines', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line-${i}`);
    const { lastFrame } = render(
      <DeployTimeline
        phases={[{ id: 'bootstrap', label: 'Bootstrap', status: 'running' }]}
        logLines={lines}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('line-14');
    expect(frame).not.toContain('line-0');
  });
});
