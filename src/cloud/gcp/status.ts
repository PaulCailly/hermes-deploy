import { InstancesClient } from '@google-cloud/compute';
import type { InstanceStatus, ResourceLedger } from '../core.js';

const GCE_STATE_MAP: Record<string, InstanceStatus['state']> = {
  PROVISIONING: 'pending',
  STAGING: 'pending',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  TERMINATED: 'terminated',
  SUSPENDING: 'stopping',
  SUSPENDED: 'stopped',
};

export async function statusGcp(ledger: ResourceLedger): Promise<InstanceStatus> {
  if (ledger.kind !== 'gcp') throw new Error('expected gcp ledger');
  const { instance_name, project_id, zone } = ledger.resources;
  if (!instance_name || !project_id || !zone) {
    return { state: 'unknown', publicIp: null };
  }

  try {
    const client = new InstancesClient();
    const [instance] = await client.get({ project: project_id, zone, instance: instance_name });
    const state = GCE_STATE_MAP[instance.status ?? ''] ?? 'unknown';
    const publicIp = instance.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP ?? null;
    return { state, publicIp };
  } catch {
    return { state: 'unknown', publicIp: null };
  }
}
