import {
  RegionOperationsClient,
  ZoneOperationsClient,
  GlobalOperationsClient,
} from '@google-cloud/compute';

/**
 * The @google-cloud/compute v6 SDK returns raw Operation proto objects
 * from insert/delete calls — they do NOT have a `.promise()` method
 * (that was the v3/v4 pattern). To wait for an operation to complete,
 * we poll the appropriate OperationsClient.wait() endpoint.
 *
 * Three scopes because GCP operations are scoped by resource type:
 *   - Regional: addresses, subnetworks
 *   - Zonal:    instances, disks
 *   - Global:   firewall rules, networks
 */

interface GcpOperation {
  name?: string | null;
  done?: boolean | null;
}

export async function waitRegionOp(
  project: string,
  region: string,
  op: GcpOperation,
): Promise<void> {
  if (op.done) return;
  const client = new RegionOperationsClient();
  let current = op;
  while (!current.done) {
    [current] = await client.wait({
      project,
      region,
      operation: current.name!,
    });
  }
}

export async function waitZoneOp(
  project: string,
  zone: string,
  op: GcpOperation,
): Promise<void> {
  if (op.done) return;
  const client = new ZoneOperationsClient();
  let current = op;
  while (!current.done) {
    [current] = await client.wait({
      project,
      zone,
      operation: current.name!,
    });
  }
}

export async function waitGlobalOp(
  project: string,
  op: GcpOperation,
): Promise<void> {
  if (op.done) return;
  const client = new GlobalOperationsClient();
  let current = op;
  while (!current.done) {
    [current] = await client.wait({
      project,
      operation: current.name!,
    });
  }
}
