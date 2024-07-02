{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs";
    nixpkgs.follows = "nixpkgs-matrix/nixpkgs";
    nixpkgs-matrix.url = "github:matrixai/nixpkgs-matrix";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        shell = { ci ? false }: with pkgs; mkShell {
          nativeBuildInputs = [
            nodejs_20
            shellcheck
            gitAndTools.gh
          ];
          NIX_DONT_SET_RPATH = true;
          NIX_NO_SELF_RPATH = true;
          shellHook = ''
            echo "Entering $(npm pkg get name)"
            set -o allexport
            . ./.env
            set +o allexport
            set -v
            ${
              lib.optionalString ci
              ''
              set -o errexit
              set -o nounset
              set -o pipefail
              shopt -s inherit_errexit
              ''
            }
            mkdir --parents "$(pwd)/tmp"
            export PATH="$(pwd)/dist/bin:$(npm root)/.bin:$PATH"
            npm install --ignore-scripts
            set +v
          '';
        };
      in
      {
        devShells = {
          default = shell { ci = false; };
          ci = shell { ci = true; };
        };
      });
}
