{
  description = "diffr, an AST-aware structural diff tool";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    # nixpkgs' rustc is below diffr's MSRV, so the toolchain comes from the
    # repo's rust-toolchain.toml via rust-overlay.
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      rust-overlay,
    }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];

      packagesFor =
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ rust-overlay.overlays.default ];
          };
          rust = pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml;
          diffr = pkgs.callPackage ./package.nix {
            rustPlatform = pkgs.makeRustPlatform {
              rustc = rust;
              cargo = rust;
            };
          };
        in
        {
          inherit diffr;
          default = diffr;
        };
    in
    {
      packages = nixpkgs.lib.genAttrs systems packagesFor;

      overlays.default = final: _prev: {
        diffr = self.packages.${final.stdenv.hostPlatform.system}.diffr;
      };

      # Use with:
      #   inputs.diffr.url = "github:devdotfast/whiteboard?dir=diffr";
      #   homeManagerModules = [ inputs.diffr.homeManagerModules.diffr ];
      #   programs.diffr.enable = true;
      homeManagerModules.diffr = import ./home-manager-module.nix self;
    };
}
