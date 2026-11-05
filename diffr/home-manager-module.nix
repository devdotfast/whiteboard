# Home Manager module for diffr, imported by flake.nix as
# `import ./home-manager-module.nix self`.
{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.diffr;
in
{
  options.programs.diffr = {
    enable = lib.mkEnableOption "diffr, an AST-aware structural diff tool";

    package = lib.mkPackageOption self.packages.${pkgs.stdenv.hostPlatform.system} "diffr" {
      default = [ "diffr" ];
      pkgsText = "diffr.packages.\${system}";
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ cfg.package ];
  };
}
