{ config, pkgs, lib, ... }:
{
  services.hermes-agent = {
    enable = true;
    configFile = ./config.yaml;
    environmentFiles = [ config.sops.secrets."hermes-env".path ];
  };

  # --- Gateway watchdog ([hermes.watchdog]) ---
  # Covers the zombie case Restart=always cannot see: the hermes-agent
  # process alive but the Discord websocket stuck in discord.py's resume
  # loop (WSServerHandshakeError against a dead session gateway host,
  # observed 2026-08-31). Restarts the service when handshake failures
  # appear in the journal, at most once per cooldown.
  systemd.services.hermes-gateway-watchdog = {
    description = "Restart hermes-agent when the Discord gateway websocket is stuck";
    serviceConfig.Type = "oneshot";
    path = [ pkgs.systemd pkgs.gnugrep pkgs.coreutils ];
    script = ''
      systemctl is-active --quiet hermes-agent || exit 0
      stamp=/run/hermes-gateway-watchdog.last-restart
      now=$(date +%s)
      if [ -f "$stamp" ] && [ $(( now - $(stat -c %Y "$stamp") )) -lt 1800 ]; then
        exit 0
      fi
      if journalctl -u hermes-agent --since "-15min" --no-pager -q | grep -q "WSServerHandshakeError"; then
        echo "gateway handshake failures within 15min — restarting hermes-agent"
        touch "$stamp"
        systemctl restart hermes-agent
      fi
    '';
  };
  systemd.timers.hermes-gateway-watchdog = {
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnBootSec = "5min";
      OnUnitActiveSec = "5min";
    };
  };

  # Restart hermes-agent whenever sops-nix re-decrypts the secrets file.
  # Without this, `secret set` + `update` re-decrypts the file on disk
  # but the running process still has the old .env loaded from startup.
  systemd.services.hermes-agent.restartTriggers = [
    config.sops.secrets."hermes-env".sopsFile
  ];
}
