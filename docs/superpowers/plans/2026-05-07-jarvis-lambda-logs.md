# Jarvis Lambda Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Jarvis on-demand CloudWatch Logs investigation via a new MCP server, so the team can debug Lambda errors from Discord.

**Architecture:** Add `awslabs.cloudwatch-mcp-server` (Python/uvx) as a new MCP server alongside existing Notion and GitHub servers. IAM instance role provides credentials. All changes go through the Jarvis deploy config at `/Users/paulcailly/work/backresto/landing-jarvis/deploy/jarvis/`.

**Tech Stack:** NixOS (uv package), shell wrapper, TOML/YAML config, AWS IAM

---

### Task 1: Create IAM policy via AWS CLI

**Files:** None (AWS API call)

- [ ] **Step 1: Create the IAM policy**

```bash
aws iam create-policy \
  --policy-name jarvis-cloudwatch-logs-read \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
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
    }]
  }'
```

Expected: Policy ARN returned like `arn:aws:iam::309151127870:policy/jarvis-cloudwatch-logs-read`.

- [ ] **Step 2: Attach the policy to the existing role**

```bash
aws iam attach-role-policy \
  --role-name jarvis-cloudwatch-role \
  --policy-arn arn:aws:iam::309151127870:policy/jarvis-cloudwatch-logs-read
```

- [ ] **Step 3: Verify**

```bash
aws iam list-attached-role-policies --role-name jarvis-cloudwatch-role
```

Expected: `jarvis-cloudwatch-logs-read` appears in the list.

---

### Task 2: Create the CloudWatch MCP wrapper script

**Files:**
- Create: `/Users/paulcailly/work/backresto/landing-jarvis/deploy/jarvis/cloudwatch-mcp-wrapper.sh`

- [ ] **Step 1: Create the wrapper script**

Create `/Users/paulcailly/work/backresto/landing-jarvis/deploy/jarvis/cloudwatch-mcp-wrapper.sh`:

```sh
#!/bin/sh
# cloudwatch-mcp-wrapper.sh
#
# Wrapper for the AWS CloudWatch MCP server. Sources hermes-agent's
# .env file for consistency, sets AWS_REGION, and execs the server
# via uvx. IAM instance role provides credentials automatically
# via IMDS — no access keys needed.
#
# Usage (from config.yaml mcp_servers entry):
#   command: sh
#   args: ["/var/lib/hermes/workspace/cloudwatch-mcp-wrapper.sh"]

set -e

ENV_FILE="${HOME:-/var/lib/hermes}/.hermes/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

export AWS_REGION="eu-west-3"

exec uvx awslabs.cloudwatch-mcp-server@latest
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x /Users/paulcailly/work/backresto/landing-jarvis/deploy/jarvis/cloudwatch-mcp-wrapper.sh
```

---

### Task 3: Update deploy config files

**Files:**
- Modify: `/Users/paulcailly/work/backresto/landing-jarvis/deploy/jarvis/hermes.toml` (documents section)
- Modify: `/Users/paulcailly/work/backresto/landing-jarvis/deploy/jarvis/config.yaml` (mcp_servers section)
- Modify: `/Users/paulcailly/work/backresto/landing-jarvis/deploy/jarvis/hermes.extra.nix` (system packages)

- [ ] **Step 1: Add wrapper to hermes.toml documents**

In `hermes.toml`, add this line inside the `[hermes.documents]` block, after the existing entries:

```toml
"cloudwatch-mcp-wrapper.sh" = "./cloudwatch-mcp-wrapper.sh"
```

- [ ] **Step 2: Add CloudWatch MCP server to config.yaml**

In `config.yaml`, add this entry under `mcp_servers:`, after the existing `github:` block:

```yaml
  cloudwatch:
    command: sh
    args: ["/var/lib/hermes/workspace/cloudwatch-mcp-wrapper.sh"]
```

- [ ] **Step 3: Add uv to NixOS system packages in hermes.extra.nix**

In `hermes.extra.nix`, add inside the main attribute set (after the `networking.firewall` block):

```nix
  # uv (Python package manager) — provides uvx for running the
  # CloudWatch MCP server (awslabs.cloudwatch-mcp-server).
  environment.systemPackages = with pkgs; [ uv ];
```

---

### Task 4: Update SOUL.md with log investigation instructions

**Files:**
- Modify: `/Users/paulcailly/work/backresto/landing-jarvis/deploy/jarvis/SOUL.md`

- [ ] **Step 1: Add Lambda log investigation section**

Add this section after the existing "Tools you have" section in SOUL.md:

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

- [ ] **Step 2: Add CloudWatch to the "Tools you have" list**

In the existing "Tools you have" section, add a new bullet:

```markdown
- **CloudWatch log investigation** (`mcp.cloudwatch.*`) — query Lambda logs, run Logs Insights queries, analyze error patterns. See the "Lambda log investigation" section below for details.
```

---

### Task 5: Commit and deploy

- [ ] **Step 1: Commit all changes in the landing-jarvis repo**

```bash
cd /Users/paulcailly/work/backresto/landing-jarvis
git add deploy/jarvis/cloudwatch-mcp-wrapper.sh \
        deploy/jarvis/hermes.toml \
        deploy/jarvis/config.yaml \
        deploy/jarvis/hermes.extra.nix \
        deploy/jarvis/SOUL.md
git commit -m "feat(jarvis): add CloudWatch MCP server for Lambda log investigation"
```

- [ ] **Step 2: Deploy to the instance**

```bash
hermes-deploy update jarvis
```

Expected: hermes-deploy uploads the new files, runs nixos-rebuild, and the agent restarts with the new MCP server available.

- [ ] **Step 3: Verify in Discord**

Ask Jarvis: "List the CloudWatch log groups for our Lambda functions."
Expected: Jarvis uses the `describe_log_groups` tool and returns a list of `/aws/lambda/*` log groups.
