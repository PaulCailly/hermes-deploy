/**
 * Starter config.yaml for `hermes-deploy init`. This is intentionally
 * minimal but valid — enough for hermes-agent to start without errors,
 * but no real platforms enabled. Users replace with their own config
 * (typically by copying from ~/.hermes/config.yaml).
 *
 * Secret references use the `${VAR}` syntax — those resolve from
 * environment variables loaded from secrets.env.enc at agent startup.
 */
export const CONFIG_YAML_TEMPLATE = `# hermes-agent runtime config.
# See https://github.com/NousResearch/hermes-agent for the full schema.
#
# Secrets: reference env vars from secrets.env.enc with \${VAR} syntax,
# e.g. \`api_key: \${ANTHROPIC_API_KEY}\`. Set them via:
#   hermes-deploy secret set ANTHROPIC_API_KEY sk-...

model:
  default: anthropic/claude-sonnet-4-5
  provider: anthropic

agent:
  max_turns: 50

terminal:
  backend: local

# Uncomment and configure platforms as needed:
#
# discord:
#   enabled: true
#   bot_token: \${DISCORD_BOT_TOKEN}
#
# mcp_servers:
#   github:
#     command: npx
#     args: ["@modelcontextprotocol/server-github"]
#     env:
#       GITHUB_TOKEN: \${GITHUB_TOKEN}
`;
