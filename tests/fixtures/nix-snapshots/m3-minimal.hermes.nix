{ config, pkgs, lib, ... }:
{
  services.hermes-agent = {
    enable = true;
    configFile = ./config.yaml;
    environmentFiles = [ config.sops.secrets."hermes-env".path ];
  };
}
