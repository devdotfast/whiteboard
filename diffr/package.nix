{
  lib,
  rustPlatform,
}:

let
  # Trim the non-build trees (sample/demo data, marketing docs, the TS
  # packages) from the source; everything else cargo might need stays.
  # cleanSourceWith rather than lib.fileset because vendored_parsers/
  # contains symlinks, which fileset cannot represent.
  root = toString ./.;
  inert = [
    "benches"
    "demo_files"
    "diffr-ts"
    "docs/images"
    "examples"
    "img"
    "sample_files"
  ];
  src = lib.cleanSourceWith {
    src = ./.;
    name = "diffr-source";
    filter =
      path: _type:
      let
        rel = lib.removePrefix (root + "/") (toString path);
      in
      toString path == root || !(lib.any (dir: rel == dir || lib.hasPrefix (dir + "/") rel) inert);
  };
in
rustPlatform.buildRustPackage (finalAttrs: {
  pname = "diffr";
  version = (lib.importTOML ./Cargo.toml).package.version;

  inherit src;

  cargoLock.lockFile = ./Cargo.lock;

  # The wasm tests build the separate plugins/ workspace via cargo at test
  # time, which needs its own dependency fetch and cannot run in the sandbox.
  doCheck = false;

  postInstall = ''
    install -Dm644 ${finalAttrs.src}/diffr.1 $out/share/man/man1/diffr.1
  '';

  meta = {
    description = "Structural diffs with a streaming API and interactive terminal frontend";
    homepage = "https://github.com/devdotfast/whiteboard/tree/main/diffr";
    changelog = "${finalAttrs.src}/CHANGELOG.md";
    license = lib.licenses.mit;
    mainProgram = "diffr";
    platforms = lib.platforms.darwin ++ lib.platforms.linux;
  };
})
