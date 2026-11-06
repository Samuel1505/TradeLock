#!/usr/bin/env bash
# Build every WASM the contract tests load (sandbox E2E). Needs: rustup, cargo-near 0.22.0, git.
#   contracts/.external/wasm/{defuse,multi_token_receiver_stub,fungible-token}.wasm   (near/intents @ defuse/v0.4.5)
#   contracts/target/near/{tradelock,tradelock_proof,mock_signer}/*.wasm
# Builds are non-reproducible (D-017): with the same toolchain the bytes match the deployed code hashes in
# docs/DEPLOYMENTS.md (tradelock sha256 e747afe8…, defuse c2830801…); another rustc version may differ.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
"$ROOT/scripts/cashrail/build-verifier.sh"
(cd "$ROOT/contracts/tradelock" && cargo near build non-reproducible-wasm)
(cd "$ROOT/contracts/tradelock-proof" && cargo near build non-reproducible-wasm)
(cd "$ROOT/contracts/mocks/mock-signer" && cargo near build non-reproducible-wasm --no-abi)
shasum -a 256 "$ROOT"/contracts/target/near/*/*.wasm "$ROOT"/contracts/.external/wasm/*.wasm
