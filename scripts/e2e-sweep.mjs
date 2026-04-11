// @ts-check
/**
 * hermes-deploy E2E resource sweeper
 * ---------------------------------------------------------------
 *
 * Nightly cleanup script for cloud resources left behind by crashed
 * E2E tests. Runs from .github/workflows/e2e.yml after the test jobs
 * complete, and can be invoked manually for local cleanup.
 *
 * Usage:
 *   node scripts/e2e-sweep.mjs --cloud aws --region us-east-1
 *   node scripts/e2e-sweep.mjs --cloud gcp --project my-proj --zone europe-west1-b
 *
 * Optional flags:
 *   --max-age-hours <n>   Only delete resources older than this many
 *                         hours (default: 4). A resource's age is
 *                         measured from its cloud-reported creation
 *                         timestamp (LaunchTime / CreateTime /
 *                         creationTimestamp).
 *   --dry-run             Print what would be deleted without touching
 *                         the cloud.
 *
 * Exit codes:
 *   0  success (including "nothing to sweep")
 *   1  one or more deletions failed with a non-idempotent error
 *   2  invalid arguments or missing credentials
 *
 * Safety rails (defense in depth):
 *
 *   Rail 1: Provenance tag — only resources carrying
 *           `managed-by=hermes-deploy` are candidates.
 *   Rail 2: E2E prefix — only resources whose
 *           `hermes-deploy/deployment` tag starts with `e2e-` are
 *           candidates. This makes the sweep totally invisible to
 *           real user deployments even if the script is invoked
 *           against the wrong account by mistake.
 *   Rail 3: Age threshold — only resources older than
 *           --max-age-hours are candidates. Keeps in-flight test
 *           runs from being interrupted.
 *
 * All three rails must be satisfied before anything is deleted.
 * Idempotent: "not found" / "in use" errors are swallowed and
 * logged, not re-thrown.
 */

import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeKeyPairsCommand,
  DescribeAddressesCommand,
  TerminateInstancesCommand,
  DeleteSecurityGroupCommand,
  DeleteKeyPairCommand,
  ReleaseAddressCommand,
  waitUntilInstanceTerminated,
} from '@aws-sdk/client-ec2';
import {
  InstancesClient,
  AddressesClient,
  FirewallsClient,
} from '@google-cloud/compute';

const MANAGED_BY_TAG_KEY = 'managed-by';
const MANAGED_BY_TAG_VALUE = 'hermes-deploy';
const DEPLOYMENT_TAG_KEY = 'hermes-deploy/deployment';
const GCP_MANAGED_BY_LABEL = 'managed-by';
const GCP_DEPLOYMENT_LABEL = 'hermes-deploy-deployment';
const E2E_PREFIX = 'e2e-';
const DEFAULT_MAX_AGE_HOURS = 4;

/**
 * @typedef {Object} SweepOptions
 * @property {number} maxAgeHours
 * @property {boolean} dryRun
 */

/**
 * @typedef {Object} SweepReport
 * @property {number} swept     Number of resources successfully deleted.
 * @property {number} skipped   Number of resources filtered out by the safety rails.
 * @property {number} errors    Number of deletions that failed with a non-idempotent error.
 * @property {string[]} notes   Human-readable log lines.
 */

/**
 * Age-check predicate: is `createdAt` more than `hours` hours before
 * `now`?
 *
 * Exported as a pure function so the unit suite can verify the
 * threshold logic without constructing a cloud client.
 *
 * @param {Date | string | number | null | undefined} createdAt
 * @param {number} hours
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isOlderThan(createdAt, hours, now = new Date()) {
  if (!createdAt) return false;
  const createdMs =
    createdAt instanceof Date
      ? createdAt.getTime()
      : new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) return false;
  const ageMs = now.getTime() - createdMs;
  return ageMs > hours * 60 * 60 * 1000;
}

/**
 * Find a tag value by key from an AWS-style Tags array.
 *
 * @param {Array<{Key?: string; Value?: string}> | undefined} tags
 * @param {string} key
 * @returns {string | undefined}
 */
export function getTagValue(tags, key) {
  return tags?.find((t) => t.Key === key)?.Value;
}

/**
 * Decide whether an AWS resource is eligible for sweeping. All three
 * safety rails must pass.
 *
 * @param {object} params
 * @param {Array<{Key?: string; Value?: string}> | undefined} params.tags
 * @param {Date | string | null | undefined} params.createdAt
 * @param {number} params.maxAgeHours
 * @param {Date} [params.now]
 * @returns {{eligible: boolean; reason?: string; deploymentName?: string}}
 */
export function isAwsSweepEligible({ tags, createdAt, maxAgeHours, now }) {
  // Rail 1: provenance tag
  if (getTagValue(tags, MANAGED_BY_TAG_KEY) !== MANAGED_BY_TAG_VALUE) {
    return { eligible: false, reason: 'missing managed-by tag' };
  }
  // Rail 2: e2e prefix
  const deploymentName = getTagValue(tags, DEPLOYMENT_TAG_KEY);
  if (!deploymentName || !deploymentName.startsWith(E2E_PREFIX)) {
    return {
      eligible: false,
      reason: `deployment name "${deploymentName ?? '(unset)'}" does not start with "${E2E_PREFIX}"`,
      deploymentName,
    };
  }
  // Rail 3: age threshold
  if (!isOlderThan(createdAt, maxAgeHours, now)) {
    return {
      eligible: false,
      reason: `created within the last ${maxAgeHours}h`,
      deploymentName,
    };
  }
  return { eligible: true, deploymentName };
}

/**
 * Decide whether a GCP resource is eligible for sweeping. Symmetric
 * with isAwsSweepEligible but takes the GCP label/timestamp shape.
 *
 * @param {object} params
 * @param {Record<string, string> | null | undefined} params.labels
 * @param {string | null | undefined} params.creationTimestamp  RFC3339
 * @param {number} params.maxAgeHours
 * @param {Date} [params.now]
 * @returns {{eligible: boolean; reason?: string; deploymentName?: string}}
 */
export function isGcpSweepEligible({
  labels,
  creationTimestamp,
  maxAgeHours,
  now,
}) {
  if (labels?.[GCP_MANAGED_BY_LABEL] !== MANAGED_BY_TAG_VALUE) {
    return { eligible: false, reason: 'missing managed-by label' };
  }
  const deploymentName = labels?.[GCP_DEPLOYMENT_LABEL];
  if (!deploymentName || !deploymentName.startsWith(E2E_PREFIX)) {
    return {
      eligible: false,
      reason: `deployment name "${deploymentName ?? '(unset)'}" does not start with "${E2E_PREFIX}"`,
      deploymentName,
    };
  }
  if (!isOlderThan(creationTimestamp, maxAgeHours, now)) {
    return {
      eligible: false,
      reason: `created within the last ${maxAgeHours}h`,
      deploymentName,
    };
  }
  return { eligible: true, deploymentName };
}

/**
 * True when a cloud SDK error means "the resource is already gone".
 * Shared between AWS and GCP because the patterns overlap.
 *
 * @param {unknown} e
 * @returns {boolean}
 */
function isNotFoundOrGone(e) {
  const msg = /** @type {Error} */ (e).message ?? '';
  return /NotFound|not found|does not exist|InvalidInstanceID|NOT_FOUND|notFound/i.test(
    msg,
  );
}

/**
 * Sweep AWS resources in the given region. Processes instances,
 * elastic IPs, security groups, and key pairs in that order (reverse
 * of provisioning dependencies).
 *
 * Accepts an EC2Client so tests can inject a mock. Production code
 * passes a real `new EC2Client({ region })`.
 *
 * @param {object} params
 * @param {EC2Client} params.ec2
 * @param {string} params.region
 * @param {number} params.maxAgeHours
 * @param {boolean} params.dryRun
 * @param {Date} [params.now]
 * @returns {Promise<SweepReport>}
 */
export async function sweepAws({ ec2, region, maxAgeHours, dryRun, now }) {
  /** @type {SweepReport} */
  const report = { swept: 0, skipped: 0, errors: 0, notes: [] };
  const tagFilters = [
    { Name: `tag:${MANAGED_BY_TAG_KEY}`, Values: [MANAGED_BY_TAG_VALUE] },
  ];

  // --- Instances ---
  const instancesResult = await ec2.send(
    new DescribeInstancesCommand({
      Filters: [
        ...tagFilters,
        {
          Name: 'instance-state-name',
          Values: ['pending', 'running', 'stopping', 'stopped'],
        },
      ],
    }),
  );
  const instances =
    instancesResult.Reservations?.flatMap((r) => r.Instances ?? []) ?? [];

  const toTerminate = [];
  for (const inst of instances) {
    const decision = isAwsSweepEligible({
      tags: inst.Tags,
      createdAt: inst.LaunchTime,
      maxAgeHours,
      now,
    });
    if (!decision.eligible) {
      report.skipped += 1;
      report.notes.push(
        `SKIP instance ${inst.InstanceId}: ${decision.reason}`,
      );
      continue;
    }
    toTerminate.push(inst);
    report.notes.push(
      `${dryRun ? 'DRY-RUN ' : ''}TERMINATE instance ${inst.InstanceId} (deployment=${decision.deploymentName})`,
    );
  }

  if (toTerminate.length > 0 && !dryRun) {
    try {
      await ec2.send(
        new TerminateInstancesCommand({
          InstanceIds: toTerminate.map((i) => /** @type {string} */ (i.InstanceId)),
        }),
      );
      await waitUntilInstanceTerminated(
        { client: ec2, maxWaitTime: 300 },
        { InstanceIds: toTerminate.map((i) => /** @type {string} */ (i.InstanceId)) },
      );
      report.swept += toTerminate.length;
    } catch (e) {
      if (isNotFoundOrGone(e)) {
        report.swept += toTerminate.length;
      } else {
        report.errors += 1;
        report.notes.push(`ERROR terminating instances: ${/** @type {Error} */ (e).message}`);
      }
    }
  } else if (toTerminate.length > 0 && dryRun) {
    report.swept += toTerminate.length;
  }

  // --- Elastic IPs ---
  const addressesResult = await ec2.send(
    new DescribeAddressesCommand({ Filters: tagFilters }),
  );
  for (const addr of addressesResult.Addresses ?? []) {
    // EIPs don't carry an AWS-side creation timestamp. Use the
    // provenance + e2e prefix rails and skip the age check by
    // passing a timestamp in the past — rail 3 becomes a no-op.
    const decision = isAwsSweepEligible({
      tags: addr.Tags,
      createdAt: new Date(0),
      maxAgeHours: 0,
      now,
    });
    if (!decision.eligible) {
      report.skipped += 1;
      report.notes.push(
        `SKIP eip ${addr.AllocationId}: ${decision.reason}`,
      );
      continue;
    }
    report.notes.push(
      `${dryRun ? 'DRY-RUN ' : ''}RELEASE eip ${addr.AllocationId} (deployment=${decision.deploymentName})`,
    );
    if (!dryRun) {
      try {
        await ec2.send(
          new ReleaseAddressCommand({ AllocationId: addr.AllocationId }),
        );
        report.swept += 1;
      } catch (e) {
        if (isNotFoundOrGone(e)) {
          report.swept += 1;
        } else {
          report.errors += 1;
          report.notes.push(
            `ERROR releasing eip ${addr.AllocationId}: ${/** @type {Error} */ (e).message}`,
          );
        }
      }
    } else {
      report.swept += 1;
    }
  }

  // --- Security groups ---
  const sgResult = await ec2.send(
    new DescribeSecurityGroupsCommand({ Filters: tagFilters }),
  );
  for (const sg of sgResult.SecurityGroups ?? []) {
    // SGs also lack an AWS-side creation timestamp. Same treatment
    // as EIPs: provenance + prefix only, skip age.
    const decision = isAwsSweepEligible({
      tags: sg.Tags,
      createdAt: new Date(0),
      maxAgeHours: 0,
      now,
    });
    if (!decision.eligible) {
      report.skipped += 1;
      report.notes.push(`SKIP sg ${sg.GroupId}: ${decision.reason}`);
      continue;
    }
    report.notes.push(
      `${dryRun ? 'DRY-RUN ' : ''}DELETE sg ${sg.GroupId} (deployment=${decision.deploymentName})`,
    );
    if (!dryRun) {
      try {
        await ec2.send(new DeleteSecurityGroupCommand({ GroupId: sg.GroupId }));
        report.swept += 1;
      } catch (e) {
        if (isNotFoundOrGone(e)) {
          report.swept += 1;
        } else {
          // SG still in use by a lingering instance. That's OK —
          // next run will try again. Log but don't count as error.
          report.notes.push(
            `SKIP sg ${sg.GroupId}: ${/** @type {Error} */ (e).message} (will retry next sweep)`,
          );
        }
      }
    } else {
      report.swept += 1;
    }
  }

  // --- Key pairs ---
  const keyPairsResult = await ec2.send(
    new DescribeKeyPairsCommand({ Filters: tagFilters }),
  );
  for (const kp of keyPairsResult.KeyPairs ?? []) {
    const decision = isAwsSweepEligible({
      tags: kp.Tags,
      createdAt: kp.CreateTime ?? new Date(0),
      maxAgeHours: kp.CreateTime ? maxAgeHours : 0,
      now,
    });
    if (!decision.eligible) {
      report.skipped += 1;
      report.notes.push(`SKIP keypair ${kp.KeyName}: ${decision.reason}`);
      continue;
    }
    report.notes.push(
      `${dryRun ? 'DRY-RUN ' : ''}DELETE keypair ${kp.KeyName} (deployment=${decision.deploymentName})`,
    );
    if (!dryRun) {
      try {
        await ec2.send(new DeleteKeyPairCommand({ KeyName: kp.KeyName }));
        report.swept += 1;
      } catch (e) {
        if (isNotFoundOrGone(e)) {
          report.swept += 1;
        } else {
          report.errors += 1;
          report.notes.push(
            `ERROR deleting keypair ${kp.KeyName}: ${/** @type {Error} */ (e).message}`,
          );
        }
      }
    } else {
      report.swept += 1;
    }
  }

  report.notes.unshift(
    `AWS sweep in ${region} (${dryRun ? 'DRY RUN' : 'LIVE'}, max-age=${maxAgeHours}h)`,
  );
  return report;
}

/**
 * Sweep GCP resources in the given project+zone. Symmetric with
 * sweepAws: instances → addresses → firewall rules.
 *
 * @param {object} params
 * @param {string} params.project
 * @param {string} params.zone
 * @param {number} params.maxAgeHours
 * @param {boolean} params.dryRun
 * @param {Date} [params.now]
 * @param {InstancesClient} [params.instancesClient]
 * @param {AddressesClient} [params.addressesClient]
 * @param {FirewallsClient} [params.firewallsClient]
 * @returns {Promise<SweepReport>}
 */
export async function sweepGcp({
  project,
  zone,
  maxAgeHours,
  dryRun,
  now,
  instancesClient = new InstancesClient(),
  addressesClient = new AddressesClient(),
  firewallsClient = new FirewallsClient(),
}) {
  /** @type {SweepReport} */
  const report = { swept: 0, skipped: 0, errors: 0, notes: [] };
  const region = zone.replace(/-[a-z]$/, '');
  const labelFilter = `labels.${GCP_MANAGED_BY_LABEL}=${MANAGED_BY_TAG_VALUE}`;

  // --- Instances ---
  for await (const inst of instancesClient.listAsync({
    project,
    zone,
    filter: labelFilter,
  })) {
    const decision = isGcpSweepEligible({
      labels: inst.labels,
      creationTimestamp: inst.creationTimestamp,
      maxAgeHours,
      now,
    });
    if (!decision.eligible) {
      report.skipped += 1;
      report.notes.push(`SKIP instance ${inst.name}: ${decision.reason}`);
      continue;
    }
    report.notes.push(
      `${dryRun ? 'DRY-RUN ' : ''}DELETE instance ${inst.name} (deployment=${decision.deploymentName})`,
    );
    if (!dryRun) {
      try {
        const [op] = await instancesClient.delete({
          project,
          zone,
          instance: inst.name,
        });
        // Best-effort wait — don't block the sweep if this takes long.
        await op.promise?.().catch(() => {});
        report.swept += 1;
      } catch (e) {
        if (isNotFoundOrGone(e)) {
          report.swept += 1;
        } else {
          report.errors += 1;
          report.notes.push(
            `ERROR deleting instance ${inst.name}: ${/** @type {Error} */ (e).message}`,
          );
        }
      }
    } else {
      report.swept += 1;
    }
  }

  // --- Addresses (static IPs) ---
  for await (const addr of addressesClient.listAsync({
    project,
    region,
  })) {
    // GCP addresses don't carry labels; match by name convention.
    // Our provisioner names them `hermes-deploy-<deploymentName>`.
    if (!addr.name?.startsWith('hermes-deploy-')) {
      report.skipped += 1;
      continue;
    }
    const deploymentName = addr.name.replace(/^hermes-deploy-/, '');
    if (!deploymentName.startsWith(E2E_PREFIX)) {
      report.skipped += 1;
      report.notes.push(
        `SKIP address ${addr.name}: deployment name does not start with "${E2E_PREFIX}"`,
      );
      continue;
    }
    if (!isOlderThan(addr.creationTimestamp, maxAgeHours, now)) {
      report.skipped += 1;
      report.notes.push(
        `SKIP address ${addr.name}: created within the last ${maxAgeHours}h`,
      );
      continue;
    }
    report.notes.push(
      `${dryRun ? 'DRY-RUN ' : ''}DELETE address ${addr.name}`,
    );
    if (!dryRun) {
      try {
        const [op] = await addressesClient.delete({
          project,
          region,
          address: addr.name,
        });
        await op.promise?.().catch(() => {});
        report.swept += 1;
      } catch (e) {
        if (isNotFoundOrGone(e)) {
          report.swept += 1;
        } else {
          report.errors += 1;
          report.notes.push(
            `ERROR deleting address ${addr.name}: ${/** @type {Error} */ (e).message}`,
          );
        }
      }
    } else {
      report.swept += 1;
    }
  }

  // --- Firewall rules ---
  for await (const rule of firewallsClient.listAsync({ project })) {
    // Same as addresses: no labels, match by name convention.
    // Provisioner names rules `hermes-deploy-<deploymentName>-ssh`
    // and `hermes-deploy-<deploymentName>-ports`.
    if (!rule.name?.startsWith('hermes-deploy-')) {
      report.skipped += 1;
      continue;
    }
    const stem = rule.name.replace(/^hermes-deploy-/, '').replace(/-(ssh|ports)$/, '');
    if (!stem.startsWith(E2E_PREFIX)) {
      report.skipped += 1;
      report.notes.push(
        `SKIP firewall ${rule.name}: derived deployment name "${stem}" does not start with "${E2E_PREFIX}"`,
      );
      continue;
    }
    if (!isOlderThan(rule.creationTimestamp, maxAgeHours, now)) {
      report.skipped += 1;
      report.notes.push(
        `SKIP firewall ${rule.name}: created within the last ${maxAgeHours}h`,
      );
      continue;
    }
    report.notes.push(
      `${dryRun ? 'DRY-RUN ' : ''}DELETE firewall ${rule.name}`,
    );
    if (!dryRun) {
      try {
        const [op] = await firewallsClient.delete({
          project,
          firewall: rule.name,
        });
        await op.promise?.().catch(() => {});
        report.swept += 1;
      } catch (e) {
        if (isNotFoundOrGone(e)) {
          report.swept += 1;
        } else {
          report.errors += 1;
          report.notes.push(
            `ERROR deleting firewall ${rule.name}: ${/** @type {Error} */ (e).message}`,
          );
        }
      }
    } else {
      report.swept += 1;
    }
  }

  report.notes.unshift(
    `GCP sweep in ${project}/${zone} (${dryRun ? 'DRY RUN' : 'LIVE'}, max-age=${maxAgeHours}h)`,
  );
  return report;
}

/**
 * Parse a --flag=value / --flag value command line into a simple map.
 *
 * @param {string[]} argv
 * @returns {Record<string, string | true>}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string | true>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[arg.slice(2)] = next;
        i += 1;
      } else {
        out[arg.slice(2)] = true;
      }
    }
  }
  return out;
}

/**
 * Pretty-print a report to stdout and exit with the appropriate code.
 *
 * @param {SweepReport} report
 */
function printReport(report) {
  for (const note of report.notes) console.log(note);
  console.log('');
  console.log(
    `Summary: swept=${report.swept}, skipped=${report.skipped}, errors=${report.errors}`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cloud = /** @type {string | undefined} */ (args.cloud);
  const maxAgeHours = args['max-age-hours']
    ? Number(args['max-age-hours'])
    : DEFAULT_MAX_AGE_HOURS;
  const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';

  if (!cloud || (cloud !== 'aws' && cloud !== 'gcp')) {
    console.error(
      'Usage: node scripts/e2e-sweep.mjs --cloud <aws|gcp> [--region <r>] [--project <p>] [--zone <z>] [--max-age-hours <n>] [--dry-run]',
    );
    process.exit(2);
  }
  if (Number.isNaN(maxAgeHours) || maxAgeHours < 0) {
    console.error(`invalid --max-age-hours: ${args['max-age-hours']}`);
    process.exit(2);
  }

  if (cloud === 'aws') {
    const region = /** @type {string | undefined} */ (
      args.region ?? process.env.AWS_REGION
    );
    if (!region) {
      console.error('--region is required for --cloud aws (or set AWS_REGION)');
      process.exit(2);
    }
    const ec2 = new EC2Client({ region });
    const report = await sweepAws({ ec2, region, maxAgeHours, dryRun });
    printReport(report);
    process.exit(report.errors > 0 ? 1 : 0);
  }

  // cloud === 'gcp'
  const project = /** @type {string | undefined} */ (
    args.project ?? process.env.GOOGLE_CLOUD_PROJECT
  );
  const zone = /** @type {string | undefined} */ (
    args.zone ?? process.env.HERMES_E2E_GCP_ZONE
  );
  if (!project) {
    console.error(
      '--project is required for --cloud gcp (or set GOOGLE_CLOUD_PROJECT)',
    );
    process.exit(2);
  }
  if (!zone) {
    console.error(
      '--zone is required for --cloud gcp (or set HERMES_E2E_GCP_ZONE)',
    );
    process.exit(2);
  }
  const report = await sweepGcp({ project, zone, maxAgeHours, dryRun });
  printReport(report);
  process.exit(report.errors > 0 ? 1 : 0);
}

// Run as CLI only when the script is the Node entry point. Importing
// the module (from a test, or from another script) should never
// trigger main(). The canonical check compares import.meta.url (the
// ESM module URL) to a file:// URL constructed from process.argv[1]
// (the actual entry file). Anything else — dynamic imports, vitest's
// transform pipeline, re-exports from another file — deliberately
// fails the check.
import { pathToFileURL } from 'node:url';

const isDirectInvocation =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  main().catch((e) => {
    console.error(`sweep failed: ${e.message}`);
    process.exit(1);
  });
}
