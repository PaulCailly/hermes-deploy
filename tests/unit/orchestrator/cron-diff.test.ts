import { describe, it, expect } from 'vitest';
import { diffCrons, cronFieldsChanged, cronPlanIsEmpty, type BoxCron } from '../../../src/orchestrator/cron-diff.js';
import type { CronConfig } from '../../../src/schema/hermes-toml.js';

// Helper: a fully-defaulted declared cron (mirrors what Zod produces).
const declared = (over: Partial<CronConfig> & { name: string }): CronConfig => ({
  schedule: '0 6 * * 1-5',
  skills: [],
  enabled: true,
  ...over,
});

const boxCron = (over: Partial<BoxCron> & { id: string; name: string }): BoxCron => ({
  schedule: '0 6 * * 1-5',
  skills: [],
  enabled: true,
  ...over,
});

describe('diffCrons', () => {
  it('creates a declared cron that is absent on the box', () => {
    const plan = diffCrons([declared({ name: 'triage', prompt: 'go' })], []);
    expect(plan.creates.map(c => c.name)).toEqual(['triage']);
    expect(plan.edits).toEqual([]);
    expect(plan.removes).toEqual([]);
  });

  it('removes a box cron that is no longer declared (authoritative delete)', () => {
    const plan = diffCrons([], [boxCron({ id: 'abc123', name: 'triage' })]);
    expect(plan.removes).toEqual([{ id: 'abc123', name: 'triage' }]);
    expect(plan.creates).toEqual([]);
    expect(plan.edits).toEqual([]);
  });

  it('is a no-op when declared and box match', () => {
    const d = declared({ name: 'rm', schedule: '45 5 * * 1-5', prompt: 'x', skills: ['release-manager'], deliver: 'discord:1', enabled: true });
    const b = boxCron({ id: 'id1', name: 'rm', schedule: '45 5 * * 1-5', prompt: 'x', skills: ['release-manager'], deliver: 'discord:1', enabled: true });
    const plan = diffCrons([d], [b]);
    expect(cronPlanIsEmpty(plan)).toBe(true);
  });

  it('edits when a declarative field drifts, carrying the box id', () => {
    const d = declared({ name: 'rm', schedule: '0 7 * * 1-5', prompt: 'x' });
    const b = boxCron({ id: 'id1', name: 'rm', schedule: '45 5 * * 1-5', prompt: 'x' });
    const plan = diffCrons([d], [b]);
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0]!.id).toBe('id1');
    expect(plan.edits[0]!.changed).toEqual(['schedule']);
    expect(plan.creates).toEqual([]);
    expect(plan.removes).toEqual([]);
  });

  it('handles a mixed plan: create + edit + remove together', () => {
    const declaredCrons = [
      declared({ name: 'keep', prompt: 'same' }),
      declared({ name: 'changed', prompt: 'new' }),
      declared({ name: 'brand-new', prompt: 'hi' }),
    ];
    const boxCrons = [
      boxCron({ id: 'k', name: 'keep', prompt: 'same' }),
      boxCron({ id: 'c', name: 'changed', prompt: 'old' }),
      boxCron({ id: 'g', name: 'gone', prompt: 'bye' }),
    ];
    const plan = diffCrons(declaredCrons, boxCrons);
    expect(plan.creates.map(c => c.name)).toEqual(['brand-new']);
    expect(plan.edits.map(e => e.name)).toEqual(['changed']);
    expect(plan.removes.map(r => r.name)).toEqual(['gone']);
  });

  it('treats skills order-independently', () => {
    const d = declared({ name: 'x', skills: ['a', 'b'] });
    const b = boxCron({ id: 'i', name: 'x', skills: ['b', 'a'] });
    expect(cronFieldsChanged(d, b)).toEqual([]);
  });

  it('detects enabled drift (pause/resume)', () => {
    const d = declared({ name: 'x', enabled: false });
    const b = boxCron({ id: 'i', name: 'x', enabled: true });
    expect(cronFieldsChanged(d, b)).toEqual(['enabled']);
  });

  it('does not thrash on absent prompt vs empty box prompt', () => {
    const d = declared({ name: 'x' }); // no prompt
    const b = boxCron({ id: 'i', name: 'x', prompt: '' });
    expect(cronFieldsChanged(d, b)).toEqual([]);
  });
});
