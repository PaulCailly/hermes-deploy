export class HermesDeployError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'HermesDeployError';
  }
}

export class CloudProvisionError extends HermesDeployError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'CloudProvisionError';
  }
}

export class CloudQuotaError extends CloudProvisionError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'CloudQuotaError';
  }
}

export class SshBootstrapError extends HermesDeployError {
  constructor(message: string, public readonly publicIp: string, cause?: unknown) {
    super(message, cause);
    this.name = 'SshBootstrapError';
  }
}

export class NixosRebuildError extends HermesDeployError {
  constructor(message: string, public readonly logTail: string[], cause?: unknown) {
    super(message, cause);
    this.name = 'NixosRebuildError';
  }
}

export class HealthcheckTimeoutError extends HermesDeployError {
  constructor(message: string, public readonly journalTail: string[]) {
    super(message);
    this.name = 'HealthcheckTimeoutError';
  }
}
