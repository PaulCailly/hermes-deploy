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
}
