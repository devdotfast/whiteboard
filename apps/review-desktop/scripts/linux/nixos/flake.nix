{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      release = builtins.fromJSON (builtins.readFile ./release.json);
      package = import ./package.nix { inherit pkgs release; };
      cli = { type = "app"; program = "${package}/bin/${release.packageName}"; };
      desktop = { type = "app"; program = "${package}/bin/${release.packageName}-desktop"; };
    in {
      packages.${system} = { default = package; ${release.packageName} = package; };
      apps.${system} = { inherit cli desktop; default = desktop; };
      checks.${system}.nixos = import ./vm-test.nix { inherit pkgs package release; };
    };
}
