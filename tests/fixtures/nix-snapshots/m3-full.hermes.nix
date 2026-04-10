{ config, pkgs, lib, ... }:
{
  services.hermes-agent = {
    enable = true;
    configFile = ./config.yaml;
    environmentFiles = [ config.sops.secrets."hermes-env".path ];

    documents = {
      "SOUL.md" = ./SOUL.md;
      "persona.md" = ./persona.md;
    };

    environment = {
      LOG_LEVEL = "debug";
      RUST_BACKTRACE = "1";
    };
  };

  # Restart hermes-agent whenever sops-nix re-decrypts the secrets file.
  # Without this, `secret set` + `update` re-decrypts the file on disk
  # but the running process still has the old .env loaded from startup.
  systemd.services.hermes-agent.restartTriggers = [
    config.sops.secrets."hermes-env".path
  ];
}
