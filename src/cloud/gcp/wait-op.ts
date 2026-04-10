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
 * IMPORTANT: the v6 SDK returns `status: 'DONE'` (string) on the
 * operation proto, NOT `done: true` (boolean). The `done` field is
 * `undefined` on wait() responses even when the operation is complete.
 * We check `status === 'DONE'` to break the poll loop.
 *
 * Three scopes because GCP operations are scoped by resource type:
 *   - Regional: addresses, subnetworks
 *   - Zonal:    instances, disks
 *   - Global:   firewall rules, networks
 */

// Use a loose interface so we don't depend on the proto's Status enum.
// The wait() response has `status` as a proto enum ('DONE'/'RUNNING'/etc.)
// which TS types as a union of string literals + a numeric enum. We just
// need to compare it to the 'DONE' string.
interface GcpOperation {
  name?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  status?: any;
  done?: boolean | null;
}

function isDone(op: GcpOperation): boolean {
  return op.done === true || op.status === 'DONE';
}

export async function waitRegionOp(
  project: string,
  region: string,
  op: GcpOperation,
): Promise<void> {
  if (isDone(op)) return;
  const client = new RegionOperationsClient();
  let current = op;
  while (!isDone(current)) {
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
  if (isDone(op)) return;
  const client = new ZoneOperationsClient();
  let current = op;
  while (!isDone(current)) {
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
  if (isDone(op)) return;
  const client = new GlobalOperationsClient();
  let current = op;
  while (!isDone(current)) {
    [current] = await client.wait({
      project,
      operation: current.name!,
    });
  }
}
