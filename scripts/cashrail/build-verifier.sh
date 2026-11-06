#!/usr/bin/env bash
# Build the NEAR Intents Verifier (defuse) and upstream test contracts from source at a pinned tag (V-16).
# Output: contracts/.external/wasm/{defuse.wasm, multi_token_receiver_stub.wasm, fungible-token.wasm}
set -euo pipefail
TAG="defuse/v0.4.5"            # commit 16d04f6
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/contracts/.external/near-intents"
OUT="$ROOT/contracts/.external/wasm"
mkdir -p "$OUT"
if [ ! -d "$SRC/.git" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/near/intents.git "$SRC"
fi
git -C "$SRC" fetch -q --depth 1 origin tag "$TAG"
git -C "$SRC" checkout -q "$TAG"
echo "near/intents at $(git -C "$SRC" rev-parse --short HEAD) ($TAG)"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
(cd "$SRC/contracts/defuse" && cargo near build non-reproducible-wasm --locked --no-abi --features contract)
(cd "$SRC/tests/contracts/multi-token-receiver-stub" && cargo near build non-reproducible-wasm --locked --no-abi)
cp "$SRC/target/near/defuse/defuse.wasm" "$OUT/"
cp "$SRC"/target/near/multi_token_receiver_stub/multi_token_receiver_stub.wasm "$OUT/"
cp "$SRC/releases/fungible-token.wasm" "$OUT/"
shasum -a 256 "$OUT"/*.wasm
