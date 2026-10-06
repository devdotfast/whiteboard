{ pkgs, package, release }:
let
  app = release.packageName;
  raw = "${package.payload}/share/${app}";
  source = ./.;
  upgraded = import ./package.nix {
    inherit pkgs;
    release = release // { revision = toString (builtins.fromJSON (toString release.revision) + 1); };
  };
  probe = pkgs.buildFHSEnv {
    pname = "${app}-probe";
    inherit (release) version;
    targetPkgs = p: package.runtimePackages p ++ [ p.file p.binutils ];
    runScript = pkgs.writeShellScript "probe-installed-whiteboard" ''
      set -eu
      ${raw}/resources/app/review-runtime/bin/diffr --version
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
    environment.systemPackages = [ probe pkgs.desktop-file-utils pkgs.xdg-utils pkgs.glib.bin pkgs.python3 ];
    virtualisation = { memorySize = 4096; cores = 2; diskSize = 16384; writableStoreUseTmpfs = false; additionalPaths = [ package upgraded source pkgs.path ]; };
    nix.settings.experimental-features = [ "nix-command" "flakes" ];
    system.stateVersion = "26.05";
  };
  testScript = ''
    import shlex

    machine.wait_for_unit("graphical.target")
    machine.wait_until_succeeds("pgrep -u tester xfce4-session")
    print(machine.succeed("df -h / /nix/store"))

    def user(command):
        return machine.succeed("su - tester -c " + shlex.quote(command), timeout=300)

    user("cp -r ${source} ~/package && chmod -R u+w ~/package")
    flake = "path:/home/tester/package#${app}"
    nixpkgs = "--override-input nixpkgs path:${pkgs.path}"
    user(f"nix profile install {flake} {nixpkgs}")
    user("DO_NOT_TRACK=1 ${app} --help")
    assert "${release.version}" in user("DO_NOT_TRACK=1 ${app} --version")
    machine.fail("su - tester -c 'command -v node'")
    user("desktop-file-validate ${package}/share/applications/*.desktop")
    handler = user("xdg-mime query default x-scheme-handler/${release.urlProtocol}").strip()
    assert handler.endswith("-url-handler.desktop"), handler
    registered = user("gio mime x-scheme-handler/${release.urlProtocol}")
    assert handler in registered, handler + "\n" + registered + user("printf 'PATH=%s\nXDG_DATA_DIRS=%s\n' \"$PATH\" \"$XDG_DATA_DIRS\"; cat ${package}/share/applications/mimeinfo.cache")

    print(user("DISPLAY=:0 XAUTHORITY=/home/tester/.Xauthority DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus DO_NOT_TRACK=1 SMOKE_SCREENSHOT=/home/tester/onboarding.png ${probe}/bin/${app}-probe"))
    machine.copy_from_vm("/home/tester/onboarding.png", "onboarding.png")

    user("mkdir -p ~/.dev/reviews && echo retained > ~/.dev/reviews/nixos-install-sentinel")
    before = user("readlink -f ~/.nix-profile")
    machine.succeed("python3 -c 'import json; p=\"/home/tester/package/release.json\"; r=json.load(open(p)); r[\"revision\"] = str(int(r[\"revision\"]) + 1); json.dump(r, open(p, \"w\"))'")
    user(f"nix profile upgrade ${app} --refresh {nixpkgs}")
    print(machine.succeed("df -h / /nix/store"))
    after = user("readlink -f ~/.nix-profile")
    assert before != after, "Profile upgrade did not change the installed generation"
    user("DO_NOT_TRACK=1 ${app} --help")
    user("nix profile rollback")
    assert before == user("readlink -f ~/.nix-profile")
    user("test $(cat ~/.dev/reviews/nixos-install-sentinel) = retained")
    user("nix profile remove --all")
    machine.fail("su - tester -c 'command -v ${app}'")
    user("test $(cat ~/.dev/reviews/nixos-install-sentinel) = retained")
    user("nix profile rollback")
    user("DO_NOT_TRACK=1 ${app} --help")
  '';
}
