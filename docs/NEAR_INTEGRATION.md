# NEAR_INTEGRATION.md — How Tradelock uses each NEAR primitive

One section per integration: what it does for Tradelock, the exact flow, what must be verified, and how it fails. Treat every interface here as a hypothesis until its `DECISIONS.md` V-item is checked. Official sources:

- Chain Signatures: https://docs.near.org/chain-abstraction/chain-signatures
- NEAR Intents: https://docs.near-intents.org/ · https://github.com/near/intents
- Shade Agents: https://docs.near.org/ai/shade-agents/
- NEAR AI Cloud: https://docs.near.ai/ · https://github.com/nearai/cloud-api
- NEAR Business (reference architecture): https://business.near.com

---

## 1. Chain Signatures (MPC) — title leg

**Job:** the `tradelock` contract controls one Sepolia address per deal, which holds the eBL; it signs that address's transactions.

### 1.1 Derivation
- Inputs: MPC root public key (secp256k1 domain), predecessor account = `tradelock` contract account, path = `tradelock/deal/{deal_id}`.
- Formula (V-03): `tweak = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:" ‖ predecessor ‖ "," ‖ path)`, `child = root(domain 0) + tweak·G`.
- Off-chain: `chainsig.js@1.1.16` `deriveChildPublicKey`, root key read from `v1.signer.public_key({domain_id:0})`. Expose `derivedAddress(dealId)` in `agent/` and `web/` from one shared module.
- On-chain: the contract fetches `v1.signer.derived_public_key` and stores `keccak256(x‖y)[12..]` (D-013).
- Test: shared module == `v1.signer.derived_public_key` == contract-stored address == first real signature's recovered sender (checked on-chain with `ecrecover`, D-016).

### 1.2 Signing flow
1. Executor reads Sepolia: `nonce = eth_getTransactionCount(derived, "pending")`, fee data.
2. Executor calls `tradelock.request_title_signature(deal_id, nonce, fees, gas_limit)` with MPC deposit attached.
3. `tradelock` builds tx + payload in-contract (CONTRACTS §2.6) and calls `v1.signer.sign`.
4. MPC uses yield/resume; the callback receives `{"scheme":"Secp256k1","big_r":{"affine_point":hex33},"s":{"scalar":hex32},"recovery_id":0|1}` (V-01). `s` is low-s normalized.
5. Executor reads `get_signed_title_tx`, assembles the signed EIP-1559 tx with viem (`r = big_r[1..33]`, `s`, `yParity = recovery_id`), broadcasts.

### 1.3 First proof (V-02) — do before anything else
- `v1.signer-prod.testnet` (D-018), predecessor = `tradelock.samuelowen.testnet` running `contracts/tradelock-proof`, path `tradelock/proof/0` → derived `0x4C1fD766f54fD266509b4a578C88cE36fEd7a628`.
- Directly with the TitleEscrow transfer (T1 milestone, CLAUDE.md §6); the 0-value self-transfer step is skipped because the contract only builds TitleEscrow transfers (D-002).

### 1.4 Failure modes
Deposit insufficient → panic before calling MPC. Sign timeout → leg back to `Pending`. Wrong recovery id → broadcast fails → executor recomputes `v` alternatives only from the returned recovery id (never guesses), else re-request.

---

## 2. NEAR Intents (Verifier) — cash leg

**Job:** hold the buyer's stablecoins as `tradelock`'s internal balance; pay supplier or refund buyer.

### 2.1 Facts to rely on
- `intents.near` is mainnet-only. On testnet (D-018) the Standard rail uses our own Verifier instance or a NEP-141 escrow (V-16, S-07).
- Balances are NEP-245 internal balances; token ids are prefixed (`nep141:<contract>`, etc.).

### 2.2 Funding
- Buyer holds the stablecoin in their Intents balance (deposit from any chain via 1Click/deposit flow; web app guides).
- Buyer calls `intents.near.mt_transfer_call(receiver_id = tradelock, token_id, amount, msg = {"deal_id": N})` [V-05].
- `tradelock.mt_on_transfer` validates and returns refund amounts.
- **Fallback if `mt_transfer_call` isn't supported:** buyer transfers via `mt_transfer` to `tradelock`, then calls `tradelock.fund_deal(deal_id)`; contract checks its balance delta via a Verifier view [VERIFY view name]. Record the choice as a decision.

### 2.3 Payout / refund
- Internal: `intents.near.mt_transfer(receiver_id, token_id, amount)` from `tradelock`.
- External chain: Verifier withdraw method for the token's route with destination address/memo [V-06].
- Callbacks set `CashLeg::Done` only on success.

### 2.4 1Click API (web app only)
Used to help buyers get the stablecoin into their Intents balance from another chain. Not on the contract's critical path.

---

## 3. Confidential Intents — privacy of the cash leg

**Job:** make buyer deposit and supplier payout unlinkable; keep amounts and parties off public view.

> **Status: cut (D-018). Not implemented, not live, not claimed.** Confidential Intents exists only on mainnet; Tradelock runs on testnet. This section records the design so the rail can be added without changing the state machine.

### 3.1 Background
- Access may require enablement (an "invite-only" response has been reported).
- NEAR Business demonstrates the target pattern: a SputnikDAO treasury contract on mainnet; funds in the Intents protocol on the confidential shard; the treasury contract authorizes transactions only after approvals, by asking MPC to sign; each request commits to its quote by hash.

### 3.2 Integration shape
Implement `CashRail` with two implementations:
- `Standard` — §2 above (public internal balances).
- `Confidential` — funds held in a confidential Intents account controlled by `tradelock` through MPC signatures (pattern used by NEAR Business). Payout/refund = contract-approved, MPC-signed confidential intent.

Lifecycle code calls only `CashRail::{receive, pay, refund}`.

---

## 4. The public-storage problem (D-010) — must be resolved before claiming confidentiality

NEAR contract state and transaction arguments are public. Even with a confidential cash rail, a `Deal` that stores `amount`, `buyer`, `supplier`, and payout target in plain fields reveals them. Also, `mt_on_transfer` and any method args carrying amounts are public.

Options:
1. **Commitment model (mirrors NEAR Business):** store `terms_commitment = sha256(canonical_terms ‖ salt)`; parties hold the preimage. Lifecycle authorization still uses account ids (callers are public anyway). Payout/refund are MPC-signed confidential intents whose payload hash is approved by the contract; amounts never appear in contract args. Validation of "correct amount" moves from contract code to (a) the parties' approvals of the hash and (b) the confidential layer. Trade-off: contract can no longer itself check amounts; security rests on approvals — must be reflected in THREAT_MODEL.
2. **Minimal-public model:** accept that amounts and parties are public on NEAR; claim only unlinkability of the external payout and document contents privacy. Simpler; weaker claim.

Decision required. Until decided, README must not claim amounts or parties are private. Implementation keeps private fields in `DealPrivate` (CONTRACTS §2.3) so either model can be adopted.

---

## 5. Shade Agents — attested observer and executor

**Job:** report title facts (Sepolia) and delivery facts (carrier) that the contract can't read; run the title-leg executor.

### 5.1 Components
- Worker: TypeScript with the Shade Agent framework (`@neardefi/shade-agent-js` [V-11]), Docker image, deployed on Phala Cloud.
- Agent contract: `tradelock-agent` (CONTRACTS §3). Verifies attestation and approved code hash at registration; gates forwarding methods.

### 5.2 Worker loops
- Title watcher: deals in `Funded` (eBL) → `registry.ownerOf(tokenId)` → TitleEscrow → `holder()`, `beneficiary()` [V-09]; both == derived address on both RPC providers (D-009) → `report_title_held`.
- Executor: deals in `Settling`/`Refunding` with title leg `Pending` → request signature → broadcast → report broadcast → wait N confirmations → re-read holder/beneficiary → `report_title_transferred`.
- Delivery watcher: carrier source (V-12) → arrival/discharge event for the deal reference → `report_arrival`.

### 5.3 Rules
- Stateless; all progress from `tradelock` views.
- Reports are idempotent; multiple instances allowed.
- Code hash in `DEPLOYMENTS.md`; Docker image digest pinned.

---

## 6. NEAR AI Cloud — private document check

**Job:** compare invoice/packing list with the agreed order inside a TEE.

- Server-side call from `web/` using the OpenAI-compatible API (base URL, key, model from env).
- Prompt returns strict JSON: `{ matches: bool, mismatches: [{field, order_value, document_value, severity}] }`.
- Verify the response/model attestation with NEAR AI's verifier tooling; show the badge only on successful verification [V-13].
- Advisory only. Synthetic documents only.

---

## 7. Meta transactions (relayer)

**Job:** traders act without holding NEAR for gas.

- Client signs a NEP-366 `DelegateAction` (receiver `tradelock`, allowed method, args).
- Relayer validates allowlist + rate limit, wraps in `SignedDelegate`, submits, returns tx hash.
- Excluded from relaying: `request_title_signature` (needs MPC deposit; executor pays), owner methods.
- Reference implementation [V-14].

---

## 8. NEAR Business (optional integration)

- Positioning only unless V-15 confirms builder access.
- If possible: buyer funds a deal from a NEAR Business treasury; supplier payout to a `business.near.com` account (settles inside the confidential environment).
- Never required for the core flow.

---

## 9. Integration order

1. §1 MPC → Sepolia proof (V-01..V-04).
2. §2 Standard cash rail (V-05..V-07).
3. §5 Shade Agent title watcher + executor; then delivery watcher (V-11, V-12).
4. §4 decision D-010, then §3 Confidential rail (V-08).
5. §7 relayer, §6 NEAR AI.
