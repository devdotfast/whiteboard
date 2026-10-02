{ stableArchive, previewArchive }:
let
  stable = builtins.getFlake "file://${stableArchive}";
  preview = builtins.getFlake "file://${previewArchive}";
  pkgs = stable.inputs.nixpkgs.legacyPackages.x86_64-linux;
  packages = [ stable.packages.x86_64-linux.default preview.packages.x86_64-linux.default ];
in pkgs.testers.runNixOSTest {
  name = "whiteboard-channel-coexistence";
  nodes.machine = { ... }: {
    users.users.tester = { isNormalUser = true; uid = 1000; };
    services.xserver.enable = true;
    services.xserver.desktopManager.xfce.enable = true;
    services.xserver.displayManager.lightdm.enable = true;
    services.displayManager.autoLogin = { enable = true; user = "tester"; };
    environment.systemPackages = [ pkgs.wmctrl pkgs.glib.bin pkgs.python3 ];
    virtualisation = { memorySize = 4096; cores = 2; diskSize = 16384; writableStoreUseTmpfs = false; additionalPaths = packages ++ [ stable.outPath preview.outPath pkgs.path ]; };
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

    for source, app in [("${stable.outPath}", "whiteboard"), ("${preview.outPath}", "whiteboard-preview")]:
        user(f"nix profile install path:{source}#{app} --no-write-lock-file --override-input nixpkgs path:${pkgs.path}")

    for protocol, handler in [("dev-fast-review", "dev-fast-review-url-handler.desktop"), ("dev-fast-review-preview", "dev-fast-review-preview-url-handler.desktop")]:
        assert handler in user(f"gio mime x-scheme-handler/{protocol}")
    display = "DISPLAY=:0 XAUTHORITY=/home/tester/.Xauthority DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus"
    for app in ["whiteboard", "whiteboard-preview"]:
        user(f"DO_NOT_TRACK=1 {app} --help")
        user(f"{display} DO_NOT_TRACK=1 DEV_REVIEW_HOME=/home/tester/reviews DEV_FAST_REVIEW_DESKTOP_STATE_ROOT=/home/tester/profiles/{app} {app} app launch --focus --json")

    machine.wait_until_succeeds("test -f /home/tester/reviews/review-desktop/instances/stable.json && test -f /home/tester/reviews/review-desktop/instances/preview.json")
    machine.succeed("python3 -c 'import json; p=\"/home/tester/reviews/review-desktop/instances/\"; a=json.load(open(p+\"stable.json\")); b=json.load(open(p+\"preview.json\")); assert a[\"url\"] != b[\"url\"]'")
    windows = user(f"{display} wmctrl -lx")
    assert len([line for line in windows.splitlines() if "whiteboard" in line.lower()]) >= 2, windows
    machine.screenshot("stable-and-preview")
    user("echo retained > /home/tester/reviews/nixos-coexistence-sentinel")
    user("nix profile remove --all")
    machine.fail("su - tester -c 'command -v whiteboard'")
    machine.fail("su - tester -c 'command -v whiteboard-preview'")
    user("test $(cat /home/tester/reviews/nixos-coexistence-sentinel) = retained")
    user("nix profile rollback")
    for app in ["whiteboard", "whiteboard-preview"]:
        user(f"DO_NOT_TRACK=1 {app} --help")
  '';
}
