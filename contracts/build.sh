#!/usr/bin/env bash
# Builds every contract into contracts/res/. Run it only inside the pinned image
# (see scripts/build-contracts.sh or the CI): a wasm built anywhere else embeds
# local paths and will not match the checked-in hash.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export RUSTUP_TOOLCHAIN=1.99.1

contracts=(goalars players items tickets league)
for contract in "${contracts[@]}"; do
  cargo near build non-reproducible-wasm --locked --manifest-path "$contract/Cargo.toml"
done

target_dir=${CARGO_TARGET_DIR:-target}
mkdir -p res
for contract in "${contracts[@]}"; do
  cp "$target_dir/near/$contract/$contract.wasm" "res/$contract.wasm"
done
sha256sum res/*.wasm
