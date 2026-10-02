{ pkgs, release }:
let
  inherit (pkgs) lib;
  app = release.packageName;
  payload = pkgs.stdenvNoCC.mkDerivation {
    pname = "${app}-payload";
    inherit (release) version;
    src = ./payload;
    nativeBuildInputs = [ pkgs.makeWrapper ];
    dontConfigure = true;
    dontBuild = true;
    dontFixup = true;
    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -r usr/bin usr/share "$out/"
      chmod 0755 "$out/share/${app}/chrome-sandbox"
      rm "$out/bin/${app}" "$out/bin/${app}-desktop"
      makeWrapper "$out/share/${app}/${app}" "$out/bin/${app}" \
        --set ELECTRON_RUN_AS_NODE 1 \
        --set DEV_FAST_REVIEW_DESKTOP_COMMAND "$out/bin/${app}-desktop" \
        --add-flags "$out/share/${app}/resources/app/review-runtime/dist/cli.js"
      makeWrapper "$out/share/${app}/${app}" "$out/bin/${app}-desktop" \
        --unset ELECTRON_RUN_AS_NODE --unset VSCODE_DEV --unset VSCODE_CLI \
        --add-flags --disable-setuid-sandbox
      substituteInPlace "$out/share/applications/"*.desktop \
        --replace-fail "/usr/bin/${app}-desktop" "${app}-desktop"
      cat > "$out/share/applications/mimeinfo.cache" <<'CACHE'
[MIME Cache]
x-scheme-handler/dev-fast-review=dev-fast-review-url-handler.desktop;
x-scheme-handler/dev-fast-review-preview=dev-fast-review-preview-url-handler.desktop;
CACHE
      runHook postInstall
    '';
  };
  runtimePackages = p: with p; [
    payload glibc glibcLocales stdenv.cc.cc.lib bash coreutils gnugrep gnused
    git xdg-utils glib gtk3 nss nspr dbus alsa-lib libgbm libglvnd libdrm
    libxkbcommon libsecret libnotify krb5 cups.lib expat fontconfig freetype
    pango cairo at-spi2-atk systemdLibs zlib openssl icu libuuid curl libunwind
    vulkan-loader
    libx11 libxcomposite libxdamage libxext libxfixes libxrandr libxcb
    libxcursor libxi libxscrnsaver libxtst libxkbfile
  ];
  environment = command: pkgs.buildFHSEnv {
    pname = command;
    inherit (release) version;
    targetPkgs = runtimePackages;
    runScript = "${payload}/bin/${command}";
    dieWithParent = false;
  };
  cli = environment app;
  desktop = environment "${app}-desktop";
in pkgs.symlinkJoin {
  name = "${app}-${release.version}-${toString release.revision}";
  paths = [ cli desktop ];
  postBuild = ''ln -s ${payload}/share "$out/share"'';
  passthru = { inherit payload runtimePackages; };
  meta = {
    description = "Guided code reviews with your coding agents";
    homepage = "https://dev.fast/";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
    mainProgram = app;
    priority = if app == "whiteboard-preview" then 6 else 5;
  };
}
