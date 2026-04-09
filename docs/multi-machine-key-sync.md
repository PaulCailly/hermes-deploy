# Multi-machine key sync

How to manage the same hermes-deploy deployment from more than one machine — laptop + desktop, or local + CI, or two team members.

## What needs to move

For each deployment under hermes-deploy's control, two pieces of secret material live under `~/.config/hermes-deploy/`:

- `ssh_keys/<name>` — the per-deployment ed25519 SSH private key. The CLI uses it to SSH into the box during `up`/`update`/`logs`/`ssh`.
- `age_keys/<name>` — the per-deployment age private key. The CLI uses it to decrypt the project's `secrets.enc.yaml` (via sops).

Plus the project's hermes-deploy state entry under `~/.config/hermes-deploy/state.toml` — but `update` rebuilds this from the cloud-side ledger if it's missing on a fresh machine, so you don't need to copy it manually.

The hermes-deploy CLI itself + the project files (hermes.toml, SOUL.md, secrets.enc.yaml, .sops.yaml) all live in your project repo and travel via `git clone`.

## Workflow: laptop → desktop

On the **source** machine (laptop):

```bash
# Export the age key
hermes-deploy key export acme-discord > /tmp/acme-discord.age

# Optional: also grab the SSH key (or regenerate on the new machine — see below)
cp ~/.config/hermes-deploy/ssh_keys/acme-discord /tmp/acme-discord.ssh
cp ~/.config/hermes-deploy/ssh_keys/acme-discord.pub /tmp/acme-discord.ssh.pub
```

Transport the files securely to the **destination** machine (desktop). **Do NOT use email**. Use one of:

- An encrypted USB drive
- A password manager that supports file attachments (1Password, Bitwarden)
- `age` itself: `age -p /tmp/acme-discord.age > /tmp/acme-discord.age.enc`, then transfer the encrypted file by any means and `age -d /tmp/acme-discord.age.enc > acme-discord.age` on the other side
- `scp` to a host you trust on both sides

On the **destination** machine (desktop):

```bash
# Clone the project from git as usual
git clone git@github.com:acme/discord-bot.git ~/clients/acme/discord-bot
cd ~/clients/acme/discord-bot

# Import the age key
hermes-deploy key import acme-discord /path/to/acme-discord.age

# Optional: import the SSH key too
mkdir -p ~/.config/hermes-deploy/ssh_keys
cp /path/to/acme-discord.ssh ~/.config/hermes-deploy/ssh_keys/acme-discord
cp /path/to/acme-discord.ssh.pub ~/.config/hermes-deploy/ssh_keys/acme-discord.pub
chmod 600 ~/.config/hermes-deploy/ssh_keys/acme-discord

# Now you can manage the deployment from the new machine
hermes-deploy update
hermes-deploy logs
```

**Important:** wipe the temp files after import. They contain unencrypted private key material.

```bash
shred -u /path/to/acme-discord.age            # on Linux
rm -P /path/to/acme-discord.age               # on macOS (rm -P overwrites)
```

## Alternative: regenerate the SSH key

If transporting the SSH key is too painful, you can skip it. The downside: your new machine needs to register *its own* SSH public key on the box before it can do anything. For M2 this means:

1. SSH into the box from a machine that has the original SSH key (your laptop)
2. Append your desktop's `~/.ssh/id_ed25519.pub` to `/root/.ssh/authorized_keys` on the box
3. Now your desktop can `ssh root@<ip>` directly with its own key

But hermes-deploy still won't be able to use that machine for `update` — it expects the per-deployment SSH key under `~/.config/hermes-deploy/ssh_keys/<name>`. You'd need to symlink or copy your desktop SSH key into that path manually, or just transport the original key.

## CI / GitHub Actions

The same workflow, with the age key stored as a GitHub Actions secret:

```yaml
- name: Restore age key
  run: |
    mkdir -p ~/.config/hermes-deploy/age_keys
    echo "$HERMES_AGE_KEY" > ~/.config/hermes-deploy/age_keys/acme-discord
    chmod 600 ~/.config/hermes-deploy/age_keys/acme-discord
  env:
    HERMES_AGE_KEY: ${{ secrets.HERMES_AGE_KEY_ACME_DISCORD }}

- name: Restore SSH key
  run: |
    mkdir -p ~/.config/hermes-deploy/ssh_keys
    echo "$HERMES_SSH_KEY" > ~/.config/hermes-deploy/ssh_keys/acme-discord
    chmod 600 ~/.config/hermes-deploy/ssh_keys/acme-discord
  env:
    HERMES_SSH_KEY: ${{ secrets.HERMES_SSH_KEY_ACME_DISCORD }}

- name: Deploy
  run: hermes-deploy update --name acme-discord
```

You can grab the SSH and age keys to put in the secrets via:

```bash
hermes-deploy key export acme-discord                          # age key contents
cat ~/.config/hermes-deploy/ssh_keys/acme-discord              # ssh private key contents
```

Paste each into a GitHub Actions secret.

## Why this is so manual in M2

M2 ships the file-based key sync because it works for the "1-3 machines, single user" case Paul is starting with. M3+ might add a richer flow:

- A trust-extension model where machine B generates its own age key and machine A signs B's public key into the project's sops recipients
- Cloud-native secret managers (AWS Secrets Manager, GCP Secret Manager) as an alternative storage backend for the keys themselves

Both are real work and need design discussion before they ship. For now: copy the file, treat it like an SSH key, wipe the temp.
