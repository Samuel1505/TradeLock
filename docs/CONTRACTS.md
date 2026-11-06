# CONTRACTS.md — Tradelock smart contracts

Implementation reference for `contracts/`. Behaviour is specified by `STATE_MACHINE.md`; this file maps it to code: layout, config, storage, methods, cross-contract calls, gas, errors, tests. Decisions: D-002, D-012, D-013, D-015, D-016, D-019, D-020, D-021.

---

## 1. Workspace

```
contracts/
  Cargo.toml                 workspace (near-sdk =5.30.0, omni-transaction =0.5.0 evm-only)
  tradelock/                 the deal contract
    src/lib.rs               Config, storage, owner methods, views, error/event helpers
    src/types.rs             Deal, legs, facts, evidence, JSON views
    src/lifecycle.rs         create/accept/decline/withdraw, D/P (accept/refuse/release), delivery, dispute, vote, timeouts
    src/cash.rs              mt_on_transfer (receive), mt_transfer / ft_withdraw (pay/refund), callback, resume
    src/title.rs             derived address (D-013), in-contract EIP-1559 tx (D-002), MPC sign + ecrecover (D-016), broadcast report
    src/confirm.rs           party confirmations (D-019/D-021), redelivery (D-015)
    src/tests.rs             unit tests (82)
    tests/sandbox.rs         nearcore sandbox E2E with the real Verifier WASM (3)
  tradelock-evm/             pure: EIP-1559 fields + payload, TradeTrust calldata, TitleEscrow CREATE2 prediction, NEAR key → EVM address
  tradelock-proof/           T1 proof contract (deployed on testnet; see DEPLOYMENTS.md)
  mocks/mock-signer/         TEST ONLY MockSigner (v1.signer stand-in for sandbox; S-05)
  cashrail-check/            V-16 sandbox check of the Verifier alone
  .external/                 near/intents @ defuse/v0.4.5 + built WASMs (gitignored; scripts/cashrail/build-verifier.sh)
```

Build: `cargo near build non-reproducible-wasm` in `contracts/tradelock` (D-017: reproducible builds need Docker). `tradelock.wasm` 348,763 B.

---

## 2. Config (`new(config)`; (o) = owner-updatable)

| Field | Meaning |
|---|---|
| `owner` | May change the fields marked (o). **No method moves deal funds, changes parties, confirms facts or signs title txs.** |
| `verifier` | Our NEAR Intents Verifier instance (V-16). `mt_on_transfer` accepts calls only from it |
| `mpc_contract` | `v1.signer-prod.testnet` (D-018) |
| `allowed_tokens` (o) | Verifier token ids, e.g. `nep141:<test usdc>` |
| `title_factories` (o) | `[{chain_id, factory, implementation}]` used to compute TitleEscrow addresses (D-021) |
| `title_registries` (o) | `[{chain_id, registry, factory}]`: registry → factory allowlist; `create_deal` rejects unlisted registries (D-021). Set together with factories via `set_title_config` |
| `mpc_sign_deposit`, `mpc_sign_gas_tgas`, `callback_gas_tgas` (o) | D-012: exact deposit forwarded; ≥ 15 Tgas on the sign receipt |
| `max_fee_per_gas`, `max_priority_fee_per_gas`, `max_gas_limit` (o) | Bounds on executor-supplied fees |
| `acceptance_window_ns` | Supplier must accept (and buyer fund) within this after `create_deal` |
| `min_doc_window_ns`, `max_doc_window_ns` | Bounds for a deal's `doc_acceptance_window_ns` |
| `paused` (o) | Blocks new deals only |

## 3. Storage

- `deals: LookupMap<u64, Deal>`, `deals_by_account: LookupMap<AccountId, Vec<u64>>` (buyer, supplier, arbiter indexed), `next_deal_id`.
- `create_deal` is payable: cost = (bytes written + 3,000 reserve) × storage byte cost; excess refunded. Deals are kept after terminal states (history for the UI and re-checking); the reserve covers later growth (votes, confirmation log capped at 24 records, legs).

## 4. Methods

| Method | Caller | Notes |
|---|---|---|
| `create_deal(terms) -> U64` | buyer (payable) | Validates terms; eBL: computes TitleEscrow (D-021) and requests the derived address (D-013) |
| `refresh_derived_address(deal_id)` | anyone | Re-issues the MPC view if the first callback failed |
| `accept_deal` / `decline_deal` | supplier | accept requires the derived address (eBL) |
| `withdraw_deal` | buyer | `Created` only |
| `mt_on_transfer(sender_id, previous_owner_ids, token_ids, amounts, msg)` | Verifier | `msg = {"deal_id": N}` (number or string). Never panics; mismatch → full refund |
| `confirm_title_held(deal_id, evidence)` | §5a confirmers | `Funded → TitleHeld`, sets `accept_by`. `evidence = {holder, beneficiary, block_number, tx_hash?}`; holder and beneficiary must equal the expected address |
| `accept_documents(deal_id)` | buyer | `TitleHeld → Settling` before `accept_by` |
| `refuse_documents(deal_id, reason_hash?)` | buyer | `TitleHeld → Refunding` before `accept_by` |
| `release(deal_id)` | anyone | `TitleHeld → Settling` at/after `accept_by` |
| `confirm_delivery(deal_id)` | buyer | escrow-only `Funded → Settling` before `deliver_by` |
| `dispute(deal_id, reason_hash?)` | buyer / supplier | `Funded`/`TitleHeld → Disputed`, once |
| `vote(deal_id, Release\|Refund)` | parties | 2 identical → execute |
| `claim_timeout(deal_id)` | anyone (`Created`) / buyer (`Funded`) | acceptance window; `ship_by` (eBL); `deliver_by` (escrow-only) |
| `resume(deal_id)` | anyone | re-issue a `Pending` cash transfer |
| `request_title_signature(deal_id, nonce, max_fee_per_gas, max_priority_fee_per_gas, gas_limit) -> Promise` | anyone (payable ≥ `mpc_sign_deposit`) | main leg in `Settling`/`Refunding`; redelivery leg after `Settled`/`Refunded` once requested |
| `report_broadcast(deal_id, tx_hash)` | anyone | informational |
| `confirm_title_transferred(deal_id, evidence)` | §5a confirmers | completes main or redelivery leg |
| `confirm_title_at_deal_address(deal_id, evidence)` | §5a confirmers | after `Settled`/`Refunded`: opens redelivery |
| `redeliver_title(deal_id)` | buyer (Settled) / supplier (Refunded) | no address argument |
| owner: `set_allowed_tokens`, `set_title_config`, `set_mpc_params`, `set_fee_bounds`, `set_paused` | owner | |
| views: `get_config`, `get_deal`, `get_deals_by_account`, `get_next_deal_id`, `derivation_path`, `preview_title_tx` | — | |

Callbacks (`#[private]`): `on_derived_public_key`, `on_cash_transfer`, `on_signature`. None of them panics on a bad external result; each moves its leg to a retryable state and emits an event.

## 5. Cross-contract calls and gas

| Call | Attached | Gas | Callback |
|---|---|---|---|
| `v1.signer.derived_public_key({path, predecessor, domain_id: 0})` | 0 | 10 Tgas | `on_derived_public_key` 10 Tgas |
| `verifier.mt_transfer({receiver_id, token_id, amount, memo})` (payout Internal / refund) | 1 yocto | 50 Tgas | `on_cash_transfer` 10 Tgas: promise success → `Done` |
| `verifier.ft_withdraw({token, receiver_id, amount, memo})` (payout Withdraw) | 1 yocto | 50 Tgas | `on_cash_transfer`: returned amount == deal amount → `Done`, else `Pending` (the Verifier re-credited us) |
| `v1.signer.sign({request: {path, payload_v2: {Ecdsa}, domain_id: 0}})` | `mpc_sign_deposit` exactly | `mpc_sign_gas_tgas` | `on_signature` `callback_gas_tgas`: parse, `ecrecover` == derived address → `Signed`, else `Pending` |

Methods that may start a cash transfer require ≥ 75 Tgas prepaid (`InsufficientGas` otherwise); `request_title_signature` requires sign + callback + 15 Tgas.

## 6. Errors

Panics with `"<Code>: <detail>"`; tests assert the code. Codes: `InvalidState`, `Unauthorized`, `DeadlinePassed`, `DeadlineNotReached`, `InvalidTerms`, `TokenNotAllowed`, `AlreadyDisputed`, `ReleaseWithoutTitle`, `LegInFlight`, `FeeOutOfBounds`, `InsufficientDeposit`, `InsufficientGas`, `Paused`, `DealNotFound`, `DerivedAddressMissing`, `EvidenceMismatch`. `mt_on_transfer` never panics (rejections are `funding_rejected` events + refunds).

## 7. Events

NEP-297 `EVENT_JSON:{"standard":"tradelock","version":"1.0.0","event":…,"data":[…]}`; list in STATE_MACHINE §8, plus `funding_rejected`, `derived_address`, `derived_address_failed`, `documents_presented`.

## 8. Tests

- `cargo test -p tradelock --lib` (82): every transition in STATE_MACHINE §5, guard failures, idempotency §7, D/P windows, votes (each pair, both directions, changes), confirmations §5a, cash failure + resume, `ft_withdraw` amount check, title tx = viem vectors, ecrecover (wrong key, MPC failure), fee bump, redelivery (two rounds, T16), TitleEscrow = real T1 escrow.
- `cargo test -p tradelock --test sandbox` (3): real nearcore + real Verifier (`defuse` v0.4.5) + test NEP-141 + MockSigner: eBL accept → Settled, refuse → Refunded, lapse → release; escrow-only with `ft_withdraw` payout and a mismatched funding refunded; MPC failure then retry.
- Prerequisites: `scripts/cashrail/build-verifier.sh`; `cargo near build non-reproducible-wasm` in `tradelock/` and `mocks/mock-signer/` (`--no-abi`).

## 9. Deploy (testnet, D-018; every command shown to the human first)

Order: test NEP-141 token → Verifier (`intents.samuelowen.testnet`, ~13 NEAR storage) → `tradelock` on `tradelock.samuelowen.testnet` with clean state (the T1 proof state must be removed first: delete and recreate the account) → config. Record hashes in DEPLOYMENTS.md.
