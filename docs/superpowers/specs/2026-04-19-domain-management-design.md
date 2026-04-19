# Domain Management & Health Verification

**Date:** 2026-04-19
**Status:** Approved

## Overview

Add domain management, reverse proxy (nginx), TLS (Let's Encrypt), and health verification to hermes-deploy. When a user adds a `[domain]` section to `hermes.toml`, the tool automatically:

1. Creates/updates a DNS A record (Route53 or Cloud DNS)
2. Configures nginx as a reverse proxy with TLS via NixOS ACME
3. Opens ports 80/443 in the cloud firewall
4. Provides domain health verification in both the CLI and dashboard

## Configuration

New optional `[domain]` section in `hermes.toml`:

```toml
[domain]
name = "jarvis.backresto.com"
upstream_port = 3000
```

- `name` — FQDN to point at the instance
- `upstream_port` — local port nginx proxies to

When `[domain]` is omitted, behavior is unchanged from today.

## Infrastructure Changes

### Deploy Flow (new work after existing phases)

**DNS provisioning** — After the instance has a public IP (post Phase 2), create/update an A record pointing `domain.name` to the instance IP. The hosted zone is looked up automatically by matching the domain's parent zone.

**nginx + TLS via NixOS** — When `[domain]` is present, the generated `configuration.nix` includes:

- `services.nginx` configured as a reverse proxy: `domain.name` → `localhost:upstream_port`
- `security.acme` for Let's Encrypt certificate provisioning and auto-renewal
- Ports 80 and 443 opened in the NixOS firewall (`networking.firewall.allowedTCPPorts`)

**Security group / firewall** — Automatically add ports 80 and 443 to cloud-level firewall rules when `[domain]` is present. Remove them when `[domain]` is removed.

### Update Flow

- Domain changed → update DNS record, regenerate nginx config, rebuild NixOS
- Domain removed → delete DNS record, remove nginx from NixOS config, close ports 80/443
- `upstream_port` changed → regenerate nginx config, rebuild NixOS
- Non-domain config changed → existing behavior, no DNS/nginx changes

### State Tracking

New fields in `state.toml` under the deployment:

- `domain_name` — the configured domain
- `dns_record_id` — cloud-specific record identifier (zone ID + record name for AWS, managed zone + record set for GCP)

### Destroy Flow

On `hermes deploy destroy`, if `domain_name` is present in state:

- Delete the DNS A record using stored `dns_record_id`
- Cloud firewall rules for 80/443 are cleaned up with the rest of the resources

## DNS Provider Integration

### AWS Route53

- Look up hosted zone via `listHostedZonesByName`, matching the parent domain (e.g., `jarvis.backresto.com` → zone for `backresto.com`)
- `changeResourceRecordSets` with `UPSERT` action for A record
- TTL: 300 seconds
- On destroy: `DELETE` the record
- Uses the same AWS SDK credentials/profile configured for EC2

### GCP Cloud DNS

- Look up managed zone via `managedZones.list`, matching DNS name suffix
- `resourceRecordSets.patch` (or create) for A record
- TTL: 300 seconds
- On destroy: delete the record set
- Uses the same GCP credentials/project configured for Compute

### Error Handling

- No matching hosted zone found → fail with message: "No DNS zone found for `{parent_domain}` in your {AWS/GCP} account. Create the zone first, then re-run."
- Record creation fails → fail the deploy at the DNS phase, do not proceed to nginx setup
- DNS propagation: after upserting, poll resolution up to 60s. If it doesn't resolve in time, warn but continue.

## Domain Health Verification

### Remote Checks (via SSH)

1. **nginx status** — `systemctl is-active nginx`
2. **nginx config** — `nginx -t`
3. **TLS cert expiry** — read from `/var/lib/acme/{domain}/cert.pem`, flag if expiring within 7 days
4. **Upstream reachable** — `curl -s -o /dev/null -w "%{http_code}" http://localhost:{upstream_port}`

### External Checks (from the hermes-deploy client)

5. **DNS resolution** — resolve `domain.name`, verify it matches the instance's public IP
6. **HTTPS response** — `GET https://{domain.name}`, capture HTTP status code
7. **TLS validity** — verify cert is valid, not expired, matches domain

### CLI Output (`hermes deploy status`)

When `[domain]` is configured, the status output includes:

```text
Domain:        jarvis.backresto.com
DNS:           ok — resolves to 13.39.38.162 (matches instance IP)
TLS:           ok — valid, expires 2026-07-10 (82 days)
nginx:         ok — active, config valid
Upstream:      ok — localhost:3000 responding (200)
HTTPS:         ok — https://jarvis.backresto.com -> 200
```

### Dashboard (InfraTab)

New "Domain" card in the infrastructure tab showing:

- Domain name
- DNS status: resolved IP, whether it matches instance IP
- TLS status: valid/invalid, expiry date, days remaining
- nginx status: running/stopped, config valid/invalid
- Upstream status: HTTP status code from localhost
- External HTTPS status: HTTP status code from public URL

Green/red indicators with raw values. Refreshed on page load alongside existing live status.

### API

New field in the status API response (`GET /api/deployments/:name`):

```typescript
domain?: {
  name: string
  checks: {
    dns: { ok: boolean; resolvedIp: string | null; expectedIp: string; matches: boolean }
    tls: { ok: boolean; valid: boolean; expiresAt: string | null; daysRemaining: number | null }
    nginx: { ok: boolean; active: boolean; configValid: boolean }
    upstream: { ok: boolean; httpStatus: number | null }
    https: { ok: boolean; httpStatus: number | null }
  }
}
```

## Files to Create/Modify

### New Files

- `src/cloud/aws/dns.ts` — Route53 A record CRUD
- `src/cloud/gcp/dns.ts` — Cloud DNS A record CRUD
- `src/remote-ops/domain-check.ts` — SSH-based nginx/TLS/upstream checks
- `src/domain/external-check.ts` — DNS resolution and HTTPS checks from client side

### Modified Files

- `src/schema/hermes-toml.ts` — Add `[domain]` schema (name + upstream_port)
- `src/schema/state-toml.ts` — Add `domain_name` and `dns_record_id` fields
- `src/schema/dto.ts` — Add domain check types to StatusPayload
- `src/nix-gen/templates.ts` — Generate nginx + ACME config when domain is present
- `src/orchestrator/deploy.ts` — Add DNS provisioning phase, pass domain config to NixOS gen
- `src/orchestrator/update.ts` — Handle domain add/change/remove
- `src/orchestrator/destroy.ts` — Clean up DNS records on destroy
- `src/cloud/aws/reconcile-network.ts` — Auto-add 80/443 when domain present
- `src/cloud/gcp/reconcile-network.ts` — Same for GCP
- `src/commands/status.ts` — Run domain checks, display results
- `src/server/routes/deployments.ts` — Include domain checks in API response
- `web/src/features/agent/InfraTab.tsx` — Domain health card
