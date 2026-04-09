export const PROJECT_GITIGNORE_TEMPLATE = `# hermes-deploy generated
.hermes-deploy/
*.log

# secrets.enc.yaml is sops-encrypted at rest and SAFE to commit.
# .sops.yaml just records the age recipients and is ALSO safe to commit.
# Both files travel with the project so a fresh clone + key import is
# enough to redeploy. See docs/multi-machine-key-sync.md.
`;
