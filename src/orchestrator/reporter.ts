export type PhaseId =
  | 'validate'
  | 'ensure-keys'
  | 'provision'
  | 'dns'
  | 'wait-ssh'
  | 'bootstrap'
  | 'healthcheck';

export interface Reporter {
  phaseStart(id: PhaseId, label: string): void;
  phaseDone(id: PhaseId): void;
  phaseFail(id: PhaseId, error: string): void;
  log(line: string): void;
  success(summary: string): void;
}

export function createPlainReporter(): Reporter {
  const start = Date.now();
  return {
    phaseStart(_id, label) {
      console.log(`▸ ${label}...`);
    },
    phaseDone(_id) {
      console.log('  ✓');
    },
    phaseFail(_id, error) {
      console.error(`  ✗ ${error}`);
    },
    log(line) {
      console.log(`    ${line}`);
    },
    success(summary) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`\n✔ ${summary} (${elapsed}s)`);
    },
  };
}
