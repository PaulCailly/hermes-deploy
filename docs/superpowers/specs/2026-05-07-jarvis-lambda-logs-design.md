# Jarvis Lambda Logs Integration

Connect Jarvis to AWS CloudWatch Logs so the team can ask Jarvis to investigate Lambda errors, search logs across functions, and debug the BackResto Amplify backend on demand via Discord.

## Context

BackResto runs an Amplify Gen 1 backend in `eu-west-3` with 38 Lambda functions covering payments (Stripe), auth (Cognito), IoT sensors (Koovea), data exports, CRM (HubSpot), and more. All functions log to CloudWatch under the standard `/aws/lambda/<function-name>` pattern. Sentry handles error alerting, but there's no way to investigate raw logs without SSH access to the AWS console.

Jarvis already runs on an EC2 instance with an IAM role (`jarvis-cloudwatch-role`) attached. The role needs CloudWatch read permissions added.

## Approach

Add the official `awslabs.cloudwatch-mcp-server` (Python/uvx) as a new MCP server in Jarvis's config. This follows the exact same pattern as the existing Notion and GitHub MCP integrations.

## Components

### 1. IAM Policy — manual AWS step

Add a managed policy to the existing `jarvis-cloudwatch-role` with these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:DescribeLogGroups",
        "logs:StartQuery",
        "logs:GetQueryResults",
        "logs:StopQuery",
        "logs:DescribeQueryDefinitions",
        "logs:ListLogAnomalyDetectors",
        "logs:ListAnomalies",
        "cloudwatch:DescribeAlarms",
        "cloudwatch:DescribeAlarmHistory",
        "cloudwatch:GetMetricData",
        "cloudwatch:ListMetrics"
      ],
      "Resource": "*"
    }
  ]
}
```

Policy name: `jarvis-cloudwatch-logs-read`.

### 2. NixOS config — `hermes.extra.nix`

Add the `uv` Python package manager to system packages. The `awslabs.cloudwatch-mcp-server` runs via `uvx` (bundled with `uv`), which is the standard Python tool runner (analogous to `npx` for Node).

Add to the existing `hermes.extra.nix`:

```nix
environment.systemPackages = with pkgs; [
  uv
];
```

### 3. MCP wrapper script — `cloudwatch-mcp-wrapper.sh`

New wrapper script following the same pattern as `mcp-wrapper.sh` and `notion-mcp-wrapper.sh`. It:

1. Sources `$HOME/.hermes/.env` to inherit AWS credentials if any are set there
2. Sets `AWS_REGION=eu-west-3` explicitly
3. Execs `uvx awslabs.cloudwatch-mcp-server@latest`

The EC2 instance's IAM role provides credentials automatically via the instance metadata service (IMDS), so no access keys are needed. The wrapper still sources `.env` for consistency and in case any AWS-related env vars are set there.

```sh
#!/bin/sh
set -e

ENV_FILE="${HOME:-/var/lib/hermes}/.hermes/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

export AWS_REGION="eu-west-3"

exec uvx awslabs.cloudwatch-mcp-server@latest
```

### 4. Deploy config changes

**`hermes.toml`** — add wrapper to documents:

```toml
[hermes.documents]
# ... existing entries ...
"cloudwatch-mcp-wrapper.sh" = "./cloudwatch-mcp-wrapper.sh"
```

**`config.yaml`** — add MCP server entry:

```yaml
mcp_servers:
  # ... existing notion, github ...
  cloudwatch:
    command: sh
    args: ["/var/lib/hermes/workspace/cloudwatch-mcp-wrapper.sh"]
```

### 5. SOUL.md update

Add a new section to Jarvis's instructions:

```markdown
## Lambda log investigation

You can query AWS CloudWatch Logs to debug the BackResto backend. Use the CloudWatch MCP tools (`mcp.cloudwatch.*`).

**Log group naming:** All Lambda functions log to `/aws/lambda/<function-name>`. There are 38 functions covering: auth (PostSignup, PreSignup), payments (CreateSubscription, PaymentWebhook, etc.), reminders, sensors (Koovea), data exports, delivery, and CRM (HubSpot).

**How to investigate:**
1. Use `describe_log_groups` to find/confirm log group names if unsure.
2. Use `execute_log_insights_query` for targeted searches. CloudWatch Logs Insights syntax examples:
   - Errors in the last hour: `fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 50`
   - Search by keyword: `fields @timestamp, @message | filter @message like /userId-123/ | sort @timestamp desc`
   - Cross-function: use `execute_cwl_insights_batch` to query multiple log groups at once.
3. Use `analyze_log_group` to get an automated anomaly/error pattern summary.

**Guidelines:**
- Start broad (last hour, error filter), then narrow based on what you find.
- When investigating a user issue, search across payment + auth log groups first — most user-facing bugs surface there.
- Summarize findings concisely. Link to specific timestamps and function names so the team can dig deeper in the AWS console if needed.
- If logs are very verbose, summarize patterns rather than dumping raw log lines.
```

## Files changed

| File | Change |
|------|--------|
| `deploy/jarvis/cloudwatch-mcp-wrapper.sh` | New file |
| `deploy/jarvis/hermes.toml` | Add document entry for wrapper |
| `deploy/jarvis/config.yaml` | Add `cloudwatch` MCP server |
| `deploy/jarvis/hermes.extra.nix` | Add `uv` to system packages |
| `deploy/jarvis/SOUL.md` | Add Lambda log investigation section |

## Manual steps (not in code)

1. Create IAM policy `jarvis-cloudwatch-logs-read` and attach to `jarvis-cloudwatch-role`
2. Run `hermes-deploy update jarvis` to push changes to the instance
3. Verify: ask Jarvis in Discord to list CloudWatch log groups

## Out of scope

- Real-time log monitoring / proactive alerting (separate feature)
- CloudWatch log shipping to the instance (journald -> CloudWatch)
- Log retention policy changes
- Structured logging improvements in Lambda functions
