{ config, pkgs, lib, ... }:
{
  services.hermes-agent = {
    enable = true;
    settings.model.default = "anthropic/claude-sonnet-4-5";
  };

  imports = [ ./configuration.nix.extra ];
}
