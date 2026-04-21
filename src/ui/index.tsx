import React from 'react';
import { render, type Instance } from 'ink';
import { DeployTimeline, type TimelinePhase } from './components/DeployTimeline.js';
import type { Reporter, PhaseId } from '../orchestrator/reporter.js';

const PHASE_LABELS: Record<PhaseId, string> = {
  validate: 'Validating project configuration',
  'ensure-keys': 'Preparing SSH and age keys',
  provision: 'Provisioning cloud resources',
  dns: 'Configuring DNS',
  'wait-ssh': 'Waiting for SSH',
  bootstrap: 'Uploading config and running nixos-rebuild',
  healthcheck: 'Waiting for hermes-agent.service',
  'flake-update': 'Updating hermes-agent flake input',
};

const ORDERED_PHASE_IDS: PhaseId[] = [
  'validate',
  'ensure-keys',
  'provision',
  'dns',
  'wait-ssh',
  'bootstrap',
  'healthcheck',
];

interface InkReporterState {
  phases: TimelinePhase[];
  logLines: string[];
  finalMessage?: string;
  finalStatus?: 'success' | 'failure';
}

/**
 * Build a Reporter that renders to an Ink TUI instead of console.log.
 * Same interface as createPlainReporter — runDeploy/runUpdate don't
 * know which they're talking to.
 *
 * Internally tracks a single timeline state object, mutates it on
 * each Reporter event, and calls instance.rerender() with the new
 * DeployTimeline props. The first event creates the Ink instance
 * (deferring render until something is happening), so commands that
 * exit before any phase starts don't leave behind a blank Ink frame.
 */
export function createInkReporter(): Reporter {
  let state: InkReporterState = {
    phases: ORDERED_PHASE_IDS.map(id => ({
      id,
      label: PHASE_LABELS[id],
      status: 'pending',
    })),
    logLines: [],
  };
  let instance: Instance | null = null;

  const rerender = () => {
    if (!instance) {
      instance = render(<DeployTimeline {...state} />);
    } else {
      instance.rerender(<DeployTimeline {...state} />);
    }
  };

  const updatePhase = (id: PhaseId, change: Partial<TimelinePhase>) => {
    state = {
      ...state,
      phases: state.phases.map(p => (p.id === id ? { ...p, ...change } : p)),
    };
    rerender();
  };

  return {
    phaseStart(id, label) {
      updatePhase(id as PhaseId, { label, status: 'running' });
    },
    phaseDone(id) {
      updatePhase(id as PhaseId, { status: 'done' });
    },
    phaseFail(id, error) {
      updatePhase(id as PhaseId, { status: 'failed', error });
    },
    log(line) {
      state = { ...state, logLines: [...state.logLines, line] };
      rerender();
    },
    success(summary) {
      state = { ...state, finalMessage: summary, finalStatus: 'success' };
      rerender();
      instance?.unmount();
    },
  };
}
