{ pkgs, package, release }:
let
  app = release.packageName;
  raw = "${package.payload}/share/${app}";
  rust = builtins.fromJSON (builtins.readFile ./rust-extension.json);
  rustVsix = pkgs.fetchurl { inherit (rust) url sha256; };
  probe = pkgs.buildFHSEnv {
    pname = "${app}-probe";
    inherit (release) version;
    targetPkgs = p: package.runtimePackages p ++ [ p.unzip p.file p.binutils ];
    runScript = pkgs.writeShellScript "probe-installed-whiteboard" ''
      set -eu
      ${raw}/resources/app/review-runtime/bin/diffr --version
      mkdir -p "$HOME/rust-extension"
      unzip -qo ${rustVsix} -d "$HOME/rust-extension"
      chmod +x "$HOME/rust-extension/extension/server/rust-analyzer"
      "$HOME/rust-extension/extension/server/rust-analyzer" --version
      while IFS= read -r -d $'\0' binary; do
        if file -b "$binary" | grep -q '^ELF .*dynamically linked'; then
          if ldd "$binary" 2>&1 | grep -q 'not found'; then
            echo "Unresolved library in $binary" >&2
            ldd "$binary" >&2
            exit 1
          fi
        fi
      done < <(find ${raw} -type f -print0)
      export APP=${app}
      export REVIEW_LINUX_DESKTOP_COMMAND=${package.payload}/bin/${app}-desktop
      exec env ELECTRON_RUN_AS_NODE=1 ${raw}/${app} ${./smoke-installed-linux.mjs}
    '';
  };
in pkgs.testers.runNixOSTest {
  name = "${app}-installed";
  nodes.machine = { ... }: {
    users.users.tester = { isNormalUser = true; uid = 1000; };
    services.xserver.enable = true;
    services.xserver.desktopManager.xfce.enable = true;
    services.xserver.displayManager.lightdm.enable = true;
    services.displayManager.autoLogin = { enable = true; user = "tester"; };
    environment.systemPackages = [ probe pkgs.desktop-file-utils pkgs.xdg-utils ];
    virtualisation = { memorySize = 4096; cores = 2; diskSize = 16384; additionalPaths = [ package ]; };
    nix.settings.experimental-features = [ "nix-command" "flakes" ];
    system.stateVersion = "26.05";
  };
  testScript = ''
    import shlex

    machine.wait_for_unit("graphical.target")
    machine.wait_until_succeeds("pgrep -u tester xfce4-session")

    def user(command):
        return machine.succeed("su - tester -c " + shlex.quote(command))

    user("nix profile install ${package}")
    user("DO_NOT_TRACK=1 ${app} --help")
    assert "${release.version}" in user("DO_NOT_TRACK=1 ${app} --version")
    machine.fail("su - tester -c 'command -v node'")
    user("desktop-file-validate ${package}/share/applications/*.desktop")
    handler = user("xdg-mime query default x-scheme-handler/${release.urlProtocol}").strip()
    assert handler.endswith("-url-handler.desktop"), handler

    user("DISPLAY=:0 XAUTHORITY=/home/tester/.Xauthority DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus DO_NOT_TRACK=1 SMOKE_SCREENSHOT=/home/tester/onboarding.png ${probe}/bin/${app}-probe")
    machine.copy_from_vm("/home/tester/onboarding.png", "onboarding.png")

    user("mkdir -p ~/.dev/reviews && echo retained > ~/.dev/reviews/nixos-install-sentinel")
    user("nix profile remove --all")
    machine.fail("su - tester -c 'command -v ${app}'")
    user("test $(cat ~/.dev/reviews/nixos-install-sentinel) = retained")
    user("nix profile rollback")
    user("DO_NOT_TRACK=1 ${app} --help")
  '';
}
