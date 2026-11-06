# DECISIONS.md — Tradelock

Two sections: (1) design decisions with rationale, (2) verification findings against external docs. Every entry is dated. When a verification finding contradicts `CLAUDE.md` or `ARCHITECTURE.md`, record it here and update those files.

Format:
```
## D-NNN — Title
Date: YYYY-MM-DD
Status: Accepted | Superseded by D-NNN | Proposed
Decision: ...
Why: ...
Consequences: ...
```

---

## Part 1 — Design decisions

## D-001 — Native 2-of-3 votes instead of a SputnikDAO per deal
Status: Accepted
Decision: Implement buyer/supplier/arbiter voting inside `tradelock`, not by deploying a SputnikDAO instance per deal.
Why: One contract holds all deals and is the single MPC predecessor, so derivation paths are deterministic per deal; fewer cross-contract hops; full lifecycle testable in one sandbox.
Consequences: README describes it as "SputnikDAO-style 2-of-3 approvals implemented natively" — never claims SputnikDAO is used.

## D-002 — In-contract EVM transaction construction
Status: Accepted
Decision: `tradelock` builds the EIP-1559 title-transfer tx (to, data, value, chain id) from stored deal fields; callers supply only nonce and bounded fee fields.
Why: Prevents anyone from obtaining an MPC signature over an arbitrary payload for the deal address (T1).
Consequences: Requires an in-contract RLP/keccak tx builder; reference-match tests against viem/ethers.

## D-003 — Mainnet NEAR + Sepolia title leg
Status: Superseded by D-018
Decision: Contracts and MPC on NEAR mainnet; title leg on Sepolia.
Why: `intents.near` has no testnet deployment; MPC signs payloads independent of target chain.
Consequences: Cash leg uses small real amounts; every mainnet action needs human confirmation.

## D-004 — Shade Agent attests title facts as well as delivery
Status: Superseded by D-019
Decision: The agent reports `title_held` and `title_transferred` from Sepolia reads, in addition to arrival.
Why: `tradelock` cannot read Sepolia; title-leg completion must rest on attested on-chain state, not "tx sent."
Consequences: Agent is on the critical path of the title leg; fallback (agent cut) is party-confirmed title receipt, disclosed.
Status update 2026-11-04: Superseded by D-019 (agent cut).

## D-005 — Intermediate states `Settling` / `Refunding` with per-leg progress
Status: Accepted
Decision: Add in-flight states and `CashLeg` / `TitleLeg` sub-states to the original seven states, plus `Cancelled`.
Why: Two-leg release must be resumable and idempotent; a single `Settled` jump cannot represent partial progress.
Consequences: More states to test; strictly simpler recovery.

## D-006 — A deal can be disputed at most once
Status: Accepted
Decision: Only one dispute per deal.
Why: Prevents dispute loops that hold funds hostage; timeouts and votes resolve it.
Consequences: Reopening requires a new deal.

## D-007 — Events carry deal id only on the Confidential rail
Status: Accepted
Decision: NEP-297 events never include amounts or counterparties when the cash rail is Confidential.
Why: Events are public; including details would defeat confidentiality.
Consequences: UI fetches details via views gated to deal parties (view authorization approach: Proposed — see D-010).

## D-008 — Settle in the deposited stablecoin
Status: Accepted
Decision: Supplier receives the same token the buyer deposited; conversion is a stretch goal.
Why: Avoids dependency on solver quotes in the critical path.
Consequences: Supplier withdraws/swaps themselves if they want another asset.

## D-009 — Agent reads Sepolia from two RPC providers
Status: Proposed
Decision: Title facts are reported only when two independent RPC providers agree.
Why: Reduces reliance on a single data source inside the TEE.
Consequences: One more env var; small latency increase.

## D-010 — Privacy of deal details in views
Status: Proposed
Decision: TBD. Options: (a) store only commitments on-chain and keep details off-chain with parties; (b) accept that view methods are public and store minimal fields.
Why: NEAR contract storage is publicly readable; "authorized views" do not hide state.
Consequences: Must be decided before the Confidential rail is claimed in README.

## D-011 — Cut order
Status: Accepted
Decision: If something stalls, cut NEAR AI document check → Confidential cash rail → Shade Agent. Never cut the title leg.
Why: The title leg is the showcase; the others have disclosed fallbacks.

## D-012 — Forward exactly the MPC deposit; refund caller excess ourselves
Date: 2026-11-04
Status: Accepted
Decision: `request_title_signature` requires attached deposit ≥ `config.mpc_sign_deposit` (currently 1 yoctoNEAR), forwards exactly that amount to `v1.signer.sign`, and refunds the caller's excess in the same call. Gas for the `sign` receipt is `config.mpc_sign_gas_tgas` (≥ 15 Tgas, live `v1.signer` config).
Why: `v1.signer` refunds excess deposit to its predecessor — our contract, not the executor (V-01). Forwarding a surplus would strand it in `tradelock`.
Consequences: Deposit and gas are owner-updatable config, never literals. If `v1.signer` raises the deposit, `sign` panics with `InsufficientDeposit` and the leg returns to `Pending`; owner updates config.

## D-013 — Contract stores each deal's derived address, fetched from `v1.signer.derived_public_key`
Date: 2026-11-04
Status: Accepted (revised on review)
Decision: At `create_deal` (eBL mode), `tradelock` cross-calls `v1.signer.derived_public_key({path: "tradelock/deal/{id}", predecessor: env::current_account_id(), domain_id: 0})`. The callback decodes the returned `secp256k1:<base58>` key, computes `address = keccak256(x‖y)[12..]` with `env::keccak256_array` and stores it in the deal. `on_title_held` / `on_title_transferred` compare evidence against this stored address only.
Why: Evidence checks need a trustworthy address; accepting it from a caller would reopen T1. No curve math is needed: the view returns the **uncompressed 64-byte x‖y** (verified 2026-11-04: base58 decodes to 64 bytes; `chainsig.js` prepends `04` to the same bytes). Keccak is a host function (near-zero WASM cost).
Consequences: Deal is not usable for the title leg until the callback stored the address; a failed view call leaves the deal without an address and `create_deal` must be retried (or a `refresh_derived_address(deal_id)` re-trigger). If a later fetch returns a different key, the contract refuses to overwrite (root key must never change). Implemented and tested in `contracts/tradelock-proof` (`fetch_derived_address` / `on_derived_public_key`); test vectors in `contracts/tradelock-proof/tests/vectors/derived_address.json`. Tests: JS (`chainsig.js`) == `v1.signer` view == contract-stored address == signer recovered from the real MPC signature.

## D-014 — Use TradeTrust's official Sepolia TitleEscrowFactory; deploy our own registry
Date: 2026-11-04
Status: Accepted
Decision: Deploy a standalone `TradeTrustToken` (v5.5.2 artifact bytecode) on Sepolia with constructor `(name, symbol, 0xfcafea839e576967b96ad1FBFB52b5CA26cd1D25)`; our deployer holds all registry roles (carrier substitution S-01). Do not deploy our own factory.
Why: (1) The factory address is TradeTrust's published Sepolia default: TradeTrust/documentation `docs/how-tos/deployment.md` (commit ebd7946, 2026-08-27) shows a Sepolia standalone registry deployment using factory `0xfcafea839e576967b96ad1FBFB52b5CA26cd1D25` as the default; the same value is `contractAddress.TitleEscrowFactory[11155111]` in `@tradetrust-tt/token-registry@5.5.2`. Note: TradeTrust's `pay-on-behalf/overview.md` lists the same address as the **Polygon Amoy** TDocDeployer — same address on two chains; on Sepolia it is the factory (it answers `implementation()`), and the Sepolia TDocDeployer there is `0x64bc6650…`, consistent with the package. (2) Its TitleEscrow implementation (0x3781bd0bbd15bf5e45c7296115821933d47362be) is bytecode-identical to v5.5.2 excluding metadata.
Consequences: Bytecode pinned to the 5.5.2 npm artifact. Because we deploy the registry, we hold `DEFAULT_ADMIN_ROLE` (pause) — the T14 power a real carrier holds (S-01). The anvil test deploys the factory artifact locally (test chain only).

## D-015 — `redeliver_title` for a rejected title after a terminal state
Date: 2026-11-04
Status: Accepted
Decision: Add `redeliver_title(deal_id)`, narrowly:
- Callable only in a terminal state by the entitled party: buyer after `Settled`, supplier after `Refunded`.
- Only after the agent attests (`on_title_returned`) that holder == beneficiary == the deal's stored derived address.
- Destination is the same stored address (`buyer_evm` after Settled, `supplier_evm` after Refunded). No caller-supplied address (D-002 intact).
- Tracked as a separate `redelivery: Option<TitleLeg>` sub-leg reusing the sign → broadcast → attest flow; the deal's state stays terminal.
Why: TradeTrust's `rejectTransferOwners` (V-10) can return title to the deal address at any time after the transfer; without this path the title would be locked forever with nobody able to move it.
Consequences: Recipient can loop reject/redeliver; each cycle costs only them (and executor gas). STATE_MACHINE §3a, CONTRACTS §2.6a, THREAT_MODEL T15 updated. Not part of T1 (proof contract has no deals).

## D-016 — Proof contract verifies the MPC signature on-chain with `ecrecover`
Date: 2026-11-04
Status: Accepted
Decision: The signature callback recovers the signer with `env::ecrecover(payload, r‖s, recovery_id, malleability_flag = true)`, hashes the 64-byte key with `env::keccak256_array`, and stores `Signed` only if it equals the stored derived address; otherwise the leg returns to `Idle`/`Pending`.
Why: Turns "MPC signed for the right address" into an on-chain check rather than an executor assumption; high-s signatures (invalid on Ethereum, EIP-2) are rejected by the malleability flag. Both are host functions, no curve math in WASM.
Consequences: `env::ecrecover` is gated behind near-sdk's `unstable` cargo feature (the host function has been in the protocol since 2021); enabled for `tradelock-proof`, to be carried into `tradelock`.

## D-017 — T1 proof built non-reproducibly
Date: 2026-11-04
Status: Accepted (proof only)
Decision: `tradelock-proof` is built with `cargo near build non-reproducible-wasm` (cargo-near 0.22.0, rustc 1.99.0, host). Code hash recorded in DEPLOYMENTS.md.
Why: Reproducible builds need Docker and a pinned image digest; the proof is throwaway and will be replaced by a clean-state `tradelock` deploy.
Consequences: The production `tradelock` deploy uses `cargo near build reproducible-wasm` with a pinned image. The proof WASM was loaded in a `near-workspaces 0.24` sandbox (real nearcore runtime) before mainnet to confirm the runtime accepts it.

## D-018 — NEAR testnet + Sepolia only; no mainnet
Date: 2026-11-04
Status: Accepted (supersedes D-003)
Decision: Build, test and demo entirely on NEAR testnet and Sepolia. Contract account and MPC predecessor: `tradelock.samuelowen.testnet` (parent `samuelowen.testnet`). MPC: `v1.signer-prod.testnet`. `samuelowen.near` is the mainnet prize-payout account only and is never used by code or scripts.
Why: Human decision: no real funds or mainnet actions in the hackathon build.
Consequences:
- Cash leg: `intents.near` is mainnet-only → our own testnet Verifier instance or NEP-141 escrow (V-16, S-07).
- Confidential Intents cut (mainnet-only) → design documented, not claimed (S-08; README, THREAT_MODEL §5, NEAR_INTEGRATION §3).
- All derived addresses changed (new predecessor + testnet MPC root key). T1 proof address: `0x4C1fD766f54fD266509b4a578C88cE36fEd7a628`.
- Every testnet transaction (NEAR and Sepolia) is shown to the human before it runs.

## D-019 — Shade Agent cut; title and delivery facts confirmed by the parties
Date: 2026-11-04
Status: Accepted
Decision: No Shade Agent, no `tradelock-agent` contract, no `agent/` worker (V-17: Phala needs a card; framework unmaintained since 2026-04-19; local mode verifies no attestation). Facts the contract cannot read are confirmed by the deal parties with re-checkable evidence `{tx_hash, block_number, holder, beneficiary}`:

| Fact | Accepted at once when confirmed by | Otherwise accepted when both of |
|---|---|---|
| `title_held` (Funded → TitleHeld) | buyer | supplier + arbiter |
| `title_transferred` (Settling, title → buyer) | buyer | supplier + arbiter |
| `title_transferred` (Refunding, title → supplier) | supplier | buyer + arbiter |
| `title_at_deal_address` after `Settled` (opens redelivery, D-015) | buyer | supplier + arbiter |
| `title_at_deal_address` after `Refunded` (opens redelivery, D-015) | supplier | buyer + arbiter |
| `delivered` (escrow-only, D-020) | buyer (`confirm_delivery`) | dispute → 2-of-3 `Release` |

Rule: the party a false confirmation would hurt may confirm alone; otherwise the other two must both confirm the same fact. Every confirmation must attest holder **and** beneficiary equal to the address the fact expects (derived address, `buyer_evm` or `supplier_evm`); the contract rejects any other value (`EvidenceMismatch`). Block numbers and tx hashes may differ between confirmers (D-021). The contract checks evidence consistency only (holder = beneficiary = the stored expected address: derived address or destination); it cannot read Sepolia. Anyone can re-check the evidence on Sepolia (TitleEscrow `holder()`/`beneficiary()`).
`after Refunded` also covers a title the supplier handed over but nobody confirmed before a `ship_by` refund: the supplier confirms it is at the deal address and redelivery returns it (no stranding).
Executor: signing requests and broadcasts are permissionless; any party runs `scripts/` (the contract builds the tx, D-002, so the executor is untrusted).
Why: Human decision (2026-11-04): no card for Phala; unattested local mode is not acceptable as a substitute.
Consequences: THREAT_MODEL T2/T3/T4 rely on parties + arbiter instead of attestation (T4 residual: supplier must dispute before `deliver_by`); `claim_timeout` is rejected while `Disputed`. Privacy track dropped (realworld only). S-10.

## D-020 — eBL mode follows documents-against-payment: no delivery step
Date: 2026-11-04
Status: Accepted
Decision: In eBL mode: `Funded → TitleHeld → accept_documents (buyer) → Settling → Settled`. `refuse_documents` (buyer) before `accept_by` → `Refunding` (cash → buyer, title → supplier). If the `doc_acceptance_window` lapses with no accept, refuse or dispute, anyone may call `release` → `Settling`. Disputes stay available until settlement starts. `ship_by` timeout (title never held) → buyer refund, unchanged. `Delivered` / `confirm_delivery` apply only to escrow-only mode.
Why: The bill of lading is control of the goods; D/P releases documents against payment, not delivery. Removes the delivery-confirmation dependency in eBL mode; a stalling buyer cannot collect the cargo without the title, so T4 is limited to escrow-only mode.
Consequences: Like real D/P, no protection against goods that do not match the order (inspection certificates on the roadmap; README limitation). `deliver_by` exists only in escrow-only terms; eBL terms carry `ship_by` + `doc_acceptance_window_ns`.

## D-021 — Contract-computed TitleEscrow address; per-confirmer evidence; any nonce when idle
Date: 2026-11-04
Status: Accepted
Decision:
1. `tradelock` computes the deal's TitleEscrow at `create_deal` with OpenZeppelin `Clones.predictDeterministicAddress`: `keccak256(0xff ‖ factory ‖ keccak256(registry ‖ tokenId) ‖ keccak256(0x3d602d80600a3d3981f3363d3d373d3d3d363d73 ‖ implementation ‖ 0x5af43d82803e903d91602b57fd5bf3))[12..]`, with `(factory, implementation)` from an owner allowlist per chain. Verified against the real T1 escrow (0x9E54…f193) on 2026-11-04.
   **Addition (accepted 2026-11-05):** the factory is not taken from deal terms. An owner-set allowlist `title_registries: [{chain_id, registry, factory}]` maps each registry to the factory it was deployed with; `create_deal` rejects any registry not in it, and every listed factory must have an implementation entry (`set_title_config` replaces both lists together). Without this, a registry using another factory would compute the wrong escrow and the deal would stall.
2. Confirmers attest `{holder, beneficiary, block_number, tx_hash?}`; holder and beneficiary must both equal the expected address (checked on-chain); block numbers may differ between confirmers (amends D-019).
3. `request_title_signature` accepts any nonce whenever the leg is `Pending`/`Signed`/`Broadcast` (not in flight). All signatures for a leg encode the same transfer to the same destination, so stale ones can only revert. Replaces the "reconcile" path.
Why: (1) removes the escrow address from what a confirmer could get wrong; (2) honest confirmers read at different blocks; (3) simpler recovery with no added risk because the direction is fixed once in flight.
Consequences: Owner allowlists `(chain_id, factory, implementation)` and `(chain_id, registry, factory)`; testnet values: Sepolia, factory `0xfcafea…1D25`, implementation `0x3781bd…62be`, registry `0x4e95…C811`.

## D-022 — Demo signs through the near CLI keychain; web app uses near-connect; timeline from state
Date: 2026-11-05
Status: Accepted
Decision: (1) `scripts/demo` sends NEAR transactions by invoking `near` (near-cli-rs 0.30.1) with `sign-with-keychain` — the signing path the human already approves — and Sepolia transactions with viem and the testnet keys in `.env`. It is state-driven: each pass reads the deal and the TitleEscrow, picks one step (pure `nextStep`, unit-tested), prints the exact command, and sends only with `--yes`. Re-running with `--deal N` resumes. (2) The web app connects wallets with `@hot-labs/near-connect@0.11.4` (the connector NEAR's docs use) and reads Sepolia with viem. (3) The deal-page timeline is derived from contract state and stored confirmations, not from an event indexer.
Why: (1) no private keys in the script for NEAR accounts; one approved signing path. (2) current NEAR docs. (3) no indexer dependency for a testnet demo; every confirmation already stores its Sepolia block.
Consequences: Running the demo requires the demo accounts' keys in the local keychain. Event-level history (NEP-297) is visible on the explorer, not in the UI.

---

## Part 2 — Verification findings

Fill each when checked. Include doc URL, version/commit, and what differs from our assumptions.

| # | Item | Checked | Finding | Action |
|---|---|---|---|---|
| V-01 | `v1.signer` `sign` request shape, deposit, gas, callback | ☑ 2026-11-04 | Args `{"request":{"path","payload_v2":{"Ecdsa":"<hex32>"},"domain_id":0}}`. Deposit **1 yoctoNEAR**; excess refunded by `v1.signer` to the predecessor (our contract). Requires ≥15 Tgas prepaid on the `sign` receipt (live config). Returns `{"scheme":"Secp256k1","big_r":{"affine_point":"<hex33>"},"s":{"scalar":"<hex32>"},"recovery_id":0\|1}`, low-s normalized. Timeout → promise error. Details below. | CLAUDE.md §6, ARCHITECTURE §4.3, CONTRACTS §2.6, NEAR_INTEGRATION §1.2 updated; D-012 |
| V-02 | MPC signature accepted by Sepolia for a tx from a derived address | ☑ 2026-11-04 | **Yes (testnet MPC, D-018).** `tradelock.samuelowen.testnet` built the TitleEscrow `transferOwners` tx in-contract, `v1.signer-prod.testnet` signed it (NEAR tx `HJyWxZri6st1SkKoJiJmFFM4qFQeHbfZG4uWu5KeGmWN`), contract `ecrecover` matched derived `0x4C1fD766f54fD266509b4a578C88cE36fEd7a628`; viem rebuilt identical bytes; Sepolia included it (https://sepolia.etherscan.io/tx/0x0430ac7a831670fbd34cbea42b1759552977cbb1ad43ef7ab5ccf782fc84cd5d, block 12062436). TitleEscrow holder = beneficiary = buyer afterwards. | T1 complete; DEPLOYMENTS.md |
| V-03 | Derived address computation (library + version) and contract-side match | ☑ 2026-11-04 | `chainsig.js@1.1.16`: tweak = sha3_256(`"near-mpc-recovery v0.1.0 epsilon derivation:" + predecessor + "," + path`); child = root + tweak·G; root = domain 0 key. Matched live `v1.signer.derived_public_key` for 3 vectors. Docs' example addresses are stale. Details below. | D-013 (contract stores address from the view); CLAUDE.md §6, NEAR_INTEGRATION §1.1 updated |
| V-04 | In-contract EIP-1559 builder crate (`omni-transaction-rs` or equivalent) | ☑ 2026-11-04 | `omni-transaction = 0.5.0` (`default-features=false, features=["evm"]`). `TransactionBuilder::new::<EVM>()…build()` → `EVMTransaction::build_for_signing()` = `0x02 ‖ rlp(fields)`; hash with `env::keccak256_array`. Do not use its `build_with_signature` (r/s as raw 32-byte strings → non-canonical RLP when leading zero); broadcaster assembles with viem. Details below. | CONTRACTS §2.6 updated |
| V-05 | `intents.near` NEP-245 `mt_transfer_call` + `mt_on_transfer` shape | ☐ | | |
| V-06 | Verifier internal transfer + withdrawal methods for payout | ☐ | | |
| V-07 | Intents token id for chosen USDC | ☐ | | |
| V-08 | Confidential Intents access for a contract-held balance | — | Not checked: mainnet-only, cut (D-018, S-08). | n/a |
| V-09 | TradeTrust token-registry v5 TitleEscrow methods, minting roles, Sepolia deploy | ☑ 2026-11-04 | `@tradetrust-tt/token-registry@5.5.2` (tag v5.5.2, cc25532). `mint(beneficiary, holder, tokenId, remark)` needs `MINTER_ROLE`; constructor grants deployer all roles. Official Sepolia `TitleEscrowFactory` 0xfcafea83… whose implementation is bytecode-identical to 5.5.2. Registry admin can `pause` (freezes transfers). Details below. | D-014 (accepted); THREAT_MODEL T14 |
| V-10 | Combined holder+beneficiary transfer when both roles held by one address | ☑ 2026-11-04 | Yes. `transferOwners(address _nominee, address newHolder, bytes _remark)` (selector `0x34427f61`) = `transferBeneficiary` + `transferHolder`, both `onlyHolder`; nomination skipped when `beneficiary == holder`. Recipient can later `rejectTransferOwners` back to the deal address. Details below. | D-015 (accepted: `redeliver_title`); THREAT_MODEL T15 |
| V-11 | Shade Agent framework | ☑ 2026-11-04 | See V-17: framework unmaintained since 2026-04-19; only Phala named. | **Cut** (D-019) |
| V-12 | Carrier tracking data source access | — | Not checked: agent cut (D-019); delivery is buyer-confirmed. | n/a |
| V-13 | NEAR AI Cloud API, credits, attestation verification tooling | ☑ 2026-11-04 | **No free tier or free credits found.** Quickstart: sign up at cloud.near.ai → "purchase credits"; pay-as-you-go/top-up; alternative: stake NEAR, rewards pay for inference ("One credit is worth one US dollar"). Cheapest TEE-verifiable model in `GET cloud-api.near.ai/v1/model/list`: `deepseek-ai/DeepSeek-V4.1-Flash-1017` $0.30 in / $1.20 out per 1M tokens (`verifiable: true`). Attestation: docs.near.ai/cloud/verification (gateway + model attestation, TLS binding, response signatures; browser verifier cloud.near.ai/verify; `nearai/nearai-cloud-verifier`). Incognito (OpenAI/Anthropic/Gemini) routes are not TEE-verified. | **Cut** (2026-11-04): spend not approved; S-09 |
| V-14 | NEP-366 relayer reference implementation | ☐ | | |
| V-15 | NEAR Business integration possibility (walkthrough) | ☐ | | |
| V-16 | `near/intents` Verifier buildable + initializable on testnet from source, with a test NEP-141 | ☑ 2026-11-04 | **Yes.** Tag `defuse/v0.4.5` (16d04f6), `cargo near build non-reproducible-wasm --locked --no-abi --features contract` → 1,287,639 B, sha256 `c2830801…28faf0` (deterministic across two builds). Init `new({config:{wnear_id, fees:{fee: <pips u32>, fee_collector}, roles:{super_admins, admins, grantees}}})`. Sandbox test `contracts/cashrail-check` passes: `ft_transfer_call` deposit (msg = receiver or empty), `mt_transfer_call` → receiver `mt_on_transfer(sender_id, previous_owner_ids, token_ids, amounts, msg) -> Vec<U128>` refund honoured, `mt_transfer` payout, `ft_withdraw(token, receiver_id, amount, memo?, msg?)`; all need 1 yocto. No existing testnet deployment (`intents.testnet`, `defuse.testnet` have no code). **Blocker: storage ≈ 12.9 NEAR for the 1.3 MB WASM** + ~2 NEAR for the test token; current testnet balances 4.99 + 5 NEAR. | S-07; human chooses funding vs NEP-141 escrow fallback |
| V-17 | Phala Cloud cost for the Shade Agent CVM; free/trial/hackathon credits | ☑ 2026-11-04 | **Cost:** smallest TDX CVM `tdx.small` (1 vCPU, 2 GB, 20 GB disk) $0.06/h, billed per minute, "no subscription and no minimum"; 20 GB storage ≈ $0.10/GB/month (≈ $2/month, charged even when stopped); running 24/7 ≈ $46/month, demo window (≈ 1 week) ≈ $11 (derived, not stated). **Credits:** phala.com/pricing: "Verified accounts get $20 in CVM credits"; cloud.phala.com/about/pricing (2026-10-06): "Some workspaces are offered a welcome credit when they add a card" (amount shown only in dashboard) → conflicting; a card is likely required. Startup program up to $1,000 (application, pre-seed–Series A, 48 h decision). No hackathon or NEAR-specific credit program found. **Framework status:** docs.near.org/ai/shade-agents: after 2026-04-19 the Shade Agent Framework is "no longer actively maintained"; docs moved to github.com/NearDeFi/shade-agent-framework/docs. Only Phala Cloud (dstack attestation) is named as TEE host. Agent contract `requires_tee = false` (local mode) "approves the agent if the caller is whitelisted… No real attestation is verified" → not a substitute (human: do not use without disclosure). Agent contracts "cannot be built on Mac machines" (use the `pivortex/near-builder` Docker image); Docker daemon is not running on this machine. | **Cut** (D-019): no card |

### V-01 detail — `v1.signer.sign`
Sources: https://docs.near.org/chain-abstraction/chain-signatures/implementation ; https://github.com/near/mpc tag `3.17.0` (d0fc87b) — `crates/contract/src/api/sign.rs`, `api/common.rs`, `crates/near-mpc-crypto-types/src/{sign.rs,primitives.rs,kdf.rs}`, `crates/near-mpc-contract-interface/src/deposits.rs`. Live mainnet `v1.signer.version()` = `"3.17.0"` (queried 2026-11-04).
- Method: `sign(request: SignRequestArgs)`, `#[payable]`. Wire JSON: `{"request":{"path":"tradelock/deal/7","payload_v2":{"Ecdsa":"<64 hex chars>"},"domain_id":0}}`. Legacy `payload` (raw `[u8;32]`) and `key_version` are still accepted as aliases; use the current names.
- Live domains: `0` = secp256k1 (CaitSith, purpose `Sign`) ← ours; `1` = ed25519; `2` = CKD; `3` = secp256k1 purpose `ForeignTx` (not for us). Root key domain 0: `secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya`.
- Deposit: `SIGN_DEPOSIT_YOCTONEAR = 1`. `require_deposit` panics if below; refunds `attached − 1` to `predecessor_account_id` (→ D-012).
- Gas: prepaid gas on the `sign` receipt must be ≥ `sign_call_gas_attachment_requirement_tera_gas` (live: 15). Callback inside MPC reserves 7 Tgas. Read live values via `v1.signer.config()`.
- Payload must be a valid secp256k1 scalar (< n) or `sign` panics; a keccak hash ≥ n has probability ~2⁻¹²⁸ — on that panic the executor changes a fee field by 1 wei.
- Return value (via yield/resume): `{"scheme":"Secp256k1","big_r":{"affine_point":"<33-byte compressed hex>"},"s":{"scalar":"<32-byte hex>"},"recovery_id":<0|1>}`. EVM: `r = big_r[1..33]`, `s = s`, `yParity = recovery_id`. `s` is low-s normalized in both ECDSA protocols (`threshold-signatures/src/ecdsa/*/sign.rs`), so `recovery_id` is directly the EIP-1559 parity. MPC verifies the signature against the derived key before resuming.
- Timeout: the yield times out → `return_signature_and_clean_state_on_success` fails the promise → our callback sees `PromiseError` → leg back to `Pending`.
- Duplicate identical requests while pending are queued and all resolved by one `respond` (fan-out) — re-requesting the same payload is safe.

### V-01 testnet re-verification (D-018)
`v1.signer-prod.testnet.version()` = `"3.18.0"` (2026-11-04). Tag `3.18.0` (e691bdb): `SIGN_DEPOSIT_YOCTONEAR = 1`; `SignRequestArgs {path, payload_v2, domain_id}` unchanged; tweak prefix unchanged; low-s normalization unchanged. `git diff 3.17.0 3.18.0` over `api/sign.rs`, `api/common.rs`, `near-mpc-crypto-types/src`, `deposits.rs` = doc comments, CKD docs, and removal of an unrelated update-deposit helper only. Live config: `sign_call_gas_attachment_requirement_tera_gas = 15`, callback 7. Domains identical to mainnet (0 = secp256k1 Sign). Root key domain 0: `secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3` (= `chainsig.js` `ROOT_PUBLIC_KEYS.TESTNET`).

### V-03 testnet vectors (D-018)
Regenerated with `pnpm gen:vectors` against `v1.signer-prod.testnet`, predecessor `tradelock.samuelowen.testnet`; chainsig.js == view for all: `tradelock/proof/0` → 0x4C1fD766f54fD266509b4a578C88cE36fEd7a628; `tradelock/deal/0` → 0xdDa5844e9C176a551DF9A6FE10cd184d3FedcA4c; `tradelock/deal/1` → 0xB7B78680Ee1514F200DFD70175337f54e1e79F2C. The mainnet vectors below are historical.

### V-03 detail — derivation
Sources: https://github.com/NearDeFi/chainsig.js (commit 17aec4f, 2026-05-11), npm `chainsig.js@1.1.16` (latest, 2026-05-12) — `src/utils/cryptography.ts` (`deriveChildPublicKey`), `src/constants.ts` (`ROOT_PUBLIC_KEYS.MAINNET` equals live domain-0 key); MPC side `near-mpc-crypto-types/src/kdf.rs` (`derive_tweak`), `contract/src/crypto_shared/kdf.rs` (`derive_key_secp256k1`).
- Formula: `tweak = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:" ‖ predecessor ‖ "," ‖ path)`; `child = root + tweak·G`; EVM address = last 20 bytes of keccak256(uncompressed child without 0x04).
- Empirical check 2026-11-04 (`chainsig.js` vs `v1.signer.derived_public_key(path, predecessor, domain_id:0)`): `example.near`/`ethereum-1` → 0xEF4Ea05e5c11057DeCC8E1bd6F5369f2acD91fA5; `example.near`/`ethereum-2` → 0x273EeB4d7651d9296ec5bD9A6cEeBCa219101cb8; `tradelock.near`/`tradelock/proof/0` → 0x4Abc235F7325d7A378AC01d05A1B122b78E2d7C3. All matched.
- Discrepancy: the docs page's Info box lists `example.near` + `ethereum-1` = 0x1b48b83a…, which does not match the current mainnet key. Do not use doc example addresses as test vectors.
- Library choice: the shared module uses `chainsig.js` `utils.cryptography.deriveChildPublicKey` with the root key read from `v1.signer.public_key({domain_id:0})` (not only the library's hard-coded constant), so a key change fails loudly.

### V-04 detail — in-contract EIP-1559 builder
Sources: https://github.com/near/omni-transaction-rs (commit 70930eb, 2026-09-09), crates.io `omni-transaction = 0.5.0` (latest) — `src/evm/evm_transaction.rs`, `evm_transaction_builder.rs`, `types.rs`.
- Builder: `TransactionBuilder::new::<EVM>().nonce(u64).to([u8;20]).value(u128).input(Vec<u8>).max_priority_fee_per_gas(u128).max_fee_per_gas(u128).gas_limit(u128).chain_id(u64).access_list(vec![]).build()` → `EVMTransaction`.
- `build_for_signing()` → `0x02 ‖ rlp([chain_id, nonce, max_priority_fee, max_fee, gas_limit, to, value, data, access_list])`. Payload = `env::keccak256_array(&bytes)`.
- Feature flags: default enables every chain (incl. starknet-crypto); use `default-features = false, features = ["evm"]`.
- `build_with_signature` appends `r`/`s` as raw `Vec<u8>`; with a leading zero byte this is non-canonical RLP and nodes reject it. Not used: the executor assembles the signed tx with viem `serializeTransaction` from the stored fields + signature.
- Reference-vector test: same fields through viem `serializeTransaction` + `keccak256` must equal the contract's payload (T1 test).

### V-09 detail — TradeTrust token-registry v5
Sources: https://github.com/TradeTrust/token-registry tag `v5.5.2` (cc25532, 2026-08-27); npm `@tradetrust-tt/token-registry@5.5.2` (latest; `contracts/TitleEscrow.sol` identical to tag). Repo `package.json` on `master` shows 5.1.1 (semantic-release does not bump it) — use npm/tag versions.
- Registry: `TradeTrustToken(string name, string symbol, address titleEscrowFactory_)`; constructor grants the deployer `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE`, `RESTORER_ROLE`, `ACCEPTER_ROLE`.
- Mint: `mint(address beneficiary, address holder, uint256 tokenId, bytes _remark)` (`0x6010a5e7`), `onlyRole(MINTER_ROLE)`, `whenNotPaused`; calls `factory.create(tokenId)` (deterministic clone, salt = keccak(registry, tokenId); `factory.getEscrowAddress(registry, tokenId)` predicts it), then `_safeMint` to the TitleEscrow with `abi.encode(beneficiary, holder, remark)`. `registry.ownerOf(tokenId)` = TitleEscrow. `factory.create` reverts if called by an EOA (`tx.origin == msg.sender`).
- TitleEscrow views: `holder()`, `beneficiary()`, `nominee()`, `prevHolder()`, `prevBeneficiary()`, `active()`, `isHoldingToken()`, `remark()`, `registry()`, `tokenId()`.
- `remark` ≤ 120 bytes (`RemarkLengthExceeded`). TradeTrust tooling encrypts remarks with the document key; Tradelock passes empty bytes.
- Deploy routes: hardhat tasks `deploy:token` (clone of TokenImplementation via TDocDeployer) / `--standalone` / `deploy:factory`. Official Sepolia addresses (`dist/constants/contract-address.js`): TitleEscrowFactory `0xfcafea839e576967b96ad1FBFB52b5CA26cd1D25`, Deployer `0x64bc665056DC8bE4092e569ED13a7F273Be28cD2`, TokenImplementation `0x45c382574bb1B9C432a2e100Ab2086A4EAcB73Fd`. Factory `implementation()` = `0x3781bd0bbd15bf5e45c7296115821933d47362be`; its runtime bytecode equals the 5.5.2 `TitleEscrow` artifact excluding the CBOR metadata tail (checked 2026-11-04) → D-014.
- Admin powers over a live title: `pause`/`unpause` (`DEFAULT_ADMIN_ROLE`) freezes every TitleEscrow action. `restore`/`burn` require the token already returned to the registry (only holder+beneficiary can `returnToIssuer`). → THREAT_MODEL T14.

### V-10 detail — one-call transfer
Source: `contracts/TitleEscrow.sol` @ v5.5.2.
- `transferOwners(address _nominee, address newHolder, bytes _remark)` = `transferBeneficiary(_nominee, _remark)` then `transferHolder(newHolder, _remark)`.
- `transferBeneficiary`: `onlyHolder`; non-zero nominee; requires `beneficiary == holder || nominee == _nominee` → **no nomination needed when one address holds both roles**.
- `transferHolder`: `onlyHolder` (still the caller after step 1); `newHolder ≠ 0`, `newHolder ≠ holder` (`RecipientAlreadyHolder`).
- Calldata for the deal address: `transferOwners(dest, dest, 0x)`. Inbound, the supplier (holder = beneficiary after mint) calls `transferOwners(dealAddr, dealAddr, 0x)` — also one tx.
- After the call, `prevBeneficiary = prevHolder = caller`. The new holder+beneficiary can `rejectTransferOwners(remark)` to return both roles to the caller. Consequences:
  - Inbound: only the deal address could reject back to the supplier; the supplier cannot pull the title back. Good.
  - Outbound: buyer (settle) / supplier (refund) can bounce title back to the deal address at any later time → D-015. Confirmed on anvil (`evm/test/titleflow.anvil.test.ts`).
