# ARCHITECTURE.md — Tradelock

Companion to `CLAUDE.md` §3–§10. This file is the detailed design: components, accounts, interfaces, sequences, and failure handling. Interfaces marked **[VERIFY]** must be checked against current docs/source before implementation; record results in `DECISIONS.md`.

---

## 1. System overview

Tradelock settles a cross-border trade as two legs held by one NEAR contract:

| Leg | Asset | Where it lives | Who controls it during the deal |
|---|---|---|---|
| Cash | Stablecoin (test NEP-141 on testnet) | Standard CashRail on NEAR testnet (V-16) | `tradelock` contract account |
| Title | eBL (TradeTrust token, owned by a TitleEscrow) | Sepolia | Deal's MPC-derived EVM address, which only `tradelock` can sign for via `v1.signer` |

The contract never releases one leg without having custody of both (eBL mode). Release = orchestrated two-leg settlement, resumable per leg. Not atomic across chains.

---

## 2. Components

### 2.1 `tradelock` (Rust, near-sdk, NEAR testnet)
Responsibilities:
- Deal registry and state machine (`STATE_MACHINE.md`).
- 2-of-3 dispute votes (buyer, supplier, arbiter).
- On-chain timeouts (`ship_by`, `deliver_by`, acceptance window).
- Receives cash via Verifier callback; pays out/refunds via Verifier.
- Constructs EIP-1559 title-transfer transactions in-contract and requests MPC signatures.
- Emits NEP-297 events for every transition.

Does NOT: read other chains, trust caller-supplied tx payloads, store document contents.
- Accepts title/delivery facts from parties per D-019 (not from an agent).

### 2.2 `tradelock-agent` — CUT (D-019)
Not built. Facts are confirmed by the deal parties (STATE_MACHINE §5a).

### 2.3 Executor scripts (any party, untrusted)
- `scripts/`: for deals in `Settling`/`Refunding` (or redelivery) with title leg `Pending`, read nonce and fees from Sepolia, call `tradelock.request_title_signature(deal_id, nonce, fees, gas_limit)`; when `Signed`, rebuild the tx with viem, verify bytes + recovered signer, broadcast, `report_broadcast`.
- The recipient then checks TitleEscrow `holder()` / `beneficiary()` on Sepolia and calls `confirm_title_transferred` (D-019).
- Stateless; all progress lives in `tradelock`. Running it twice is safe.

### 2.4 `evm/` (Foundry or Hardhat)
- Deploy a standalone `TradeTrustToken` registry from the `@tradetrust-tt/token-registry@5.5.2` artifact on Sepolia; TitleEscrow factory = TradeTrust's official Sepolia factory (D-014, proposed).
- Scripts: `mint(supplier, supplier, tokenId, 0x)` (deployer holds `MINTER_ROLE`); supplier calls `TitleEscrow.transferOwners(dealAddr, dealAddr, 0x)`.
- Local-chain tests for the same flows.

### 2.5 Relayer (TypeScript)
- NEP-366 delegate-action relayer [VERIFY reference implementation].
- Allowlist: receiver = `tradelock`, methods = user-facing deal methods only.
- Per-account rate limits; logs every relayed action.

### 2.6 Web app (Next.js + TypeScript)
- NEAR wallet selector for buyer/supplier/arbiter; viem for Sepolia reads and supplier's eBL transfer from their EVM wallet.
- Reads deal state via view methods and indexes NEP-297 events.
- Deal page shows TitleEscrow `holder()` / `beneficiary()` read live from Sepolia next to the contract's recorded state, so parties check before confirming (D-019).

### 2.7 NEAR AI Cloud — CUT (S-09)
No document check in this build.

---

## 3. Accounts and keys

| Account | Network | Purpose | Key handling |
|---|---|---|---|
| `tradelock.samuelowen.testnet` | NEAR testnet | Deal contract (T1 proof first); cash-rail balance holder; MPC predecessor for derivation | Full-access key held by human; contract methods do not need it |
| `intents.samuelowen.testnet` | NEAR testnet | Our Verifier instance (`defuse` v0.4.5, V-16) | Owner key held by human |
| `relayer.samuelowen.testnet` | NEAR testnet | Pays gas for meta-transactions | Env var on relayer host |
| Demo buyer / supplier / arbiter | NEAR testnet | Demo actors | Human wallets |
| EVM deployer ("carrier") | Sepolia | Deploys registry, mints eBLs | Env var, testnet only |
| Gas funder | Sepolia | Tops up deal-derived addresses with Sepolia ETH | Env var, testnet only |
| Deal-derived addresses | Sepolia | Hold eBL during deal | No private key exists; MPC only |

Mainnet actions require explicit human confirmation (CLAUDE.md §2).

---

## 4. Interfaces (sketch)

Names are proposals; argument types follow near-sdk JSON conventions. Adjust to verified external interfaces.

### 4.1 `tradelock` — user-facing
```
create_deal(terms: DealTerms) -> DealId                    // buyer
accept_deal(deal_id)                                       // supplier
decline_deal(deal_id)                                      // supplier
withdraw_deal(deal_id)                                     // buyer, only Created
confirm_delivery(deal_id)                                  // buyer (fallback path)
dispute(deal_id, reason_hash: Base58CryptoHash)            // buyer | supplier
vote(deal_id, decision: Release | Refund)                  // buyer | supplier | arbiter, only Disputed
claim_timeout(deal_id)                                     // buyer
settle(deal_id) / resume(deal_id)                          // anyone: re-trigger pending leg steps
```

### 4.2 `tradelock` — Verifier callback
```
mt_on_transfer(sender_id, previous_owner_ids, token_ids, amounts, msg) -> Vec<U128>  // [VERIFY]
  msg = {"deal_id": <u64>}
  returns per-token refund amounts (full refund on any mismatch)
```

### 4.3 `tradelock` — title leg
```
request_title_signature(deal_id, nonce: u64, max_fee_per_gas: U128,
                        max_priority_fee_per_gas: U128, gas_limit: U64) -> Promise
  // contract builds tx: to = deal.title_escrow, data = transferOwners(dest, dest, 0x), value = 0, chain_id
  // dest = buyer_evm (Settling) | supplier_evm (Refunding)
  // calls v1.signer.sign({request:{path:"tradelock/deal/{id}", payload_v2:{Ecdsa:hex(keccak)}, domain_id:0}})
  //   deposit: exactly config.mpc_sign_deposit (1 yocto), caller excess refunded by tradelock (D-012); gas >= 15 Tgas
  // callback parses {scheme, big_r.affine_point, s.scalar, recovery_id} -> Signed{nonce, sig}
on_signature(deal_id, nonce) -> ...                        // private callback
get_signed_title_tx(deal_id) -> Option<SignedTxParts>      // view: fields + signature for broadcaster
```

### 4.4 `tradelock` — party confirmations (D-019; rules in STATE_MACHINE §5a)
```
confirm_title_held(deal_id, evidence: TitleEvidence)            // buyer, or supplier + arbiter
confirm_title_transferred(deal_id, evidence: TitleEvidence)     // recipient, or the other two
confirm_title_at_deal_address(deal_id, evidence: TitleEvidence) // after Settled/Refunded (D-015)
report_broadcast(deal_id, nonce, tx_hash)                       // anyone; informational
```

### 4.5 Evidence types
```
TitleEvidence   { chain_id, registry, token_id, title_escrow, holder, beneficiary, block_number, tx_hash? }
ArrivalEvidence { source: String, reference: String, event_id: String, event_time: u64, location_code: String }
```

### 4.6 Views
```
get_deal(deal_id) -> DealView
get_deals_by_account(account_id, from, limit) -> Vec<DealView>
derivation_path(deal_id) -> String
get_derived_address(deal_id) -> Option<String>           // stored from v1.signer.derived_public_key at create_deal (D-013)
```

---

## 5. Sequences

### 5.1 Happy path, eBL mode
```
Buyer        Web/Relayer     tradelock        Verifier         Executor(any)     v1.signer     Sepolia
  | create_deal ─────────────►|                                                                 |
  |                Supplier accept_deal ─────►|                                                 |
  | mt_transfer_call(token, amt, msg=deal) ──────►| ──mt_on_transfer──► validate → Funded        |
  |                Supplier: transfer holder+beneficiary to derived addr ───────────────────────►|
  | buyer reads TitleEscrow holder/beneficiary on Sepolia ◄──────────────────────────────────────|
  | confirm_title_held(evidence) ────────────►|  → TitleHeld (accept_by = now + window)
  | accept_documents ────────────────────────►|  → Settling   (or: window lapses → anyone `release`)
  |                                            | cash: Verifier transfer to supplier ──►| (callback → CashLeg Done)
  |                                            |◄── request_title_signature(nonce, fees) ────────|
  |                                            | ── sign(payload, path) ───────────────────────►|
  |                                            |◄─────────────── signature (yield/resume) ──────|  → TitleLeg Signed
  |                                            |              executor assembles + broadcasts ──────────────►|
  |                                            |◄── report_broadcast(tx_hash) ───────────────────|
  | buyer checks Sepolia; confirm_title_transferred(holder=beneficiary=buyer) ►|  → TitleLeg Done → Settled
```

### 5.2 Refund paths
- **Documents refused** (`TitleHeld`, before `accept_by`, D-020): buyer `refuse_documents` → `Refunding`; cash → buyer; title → supplier via the same signing flow → `Refunded`.
- **Ship timeout** (`Funded`, eBL mode, past `ship_by`): buyer `claim_timeout` → `Refunding`; cash → buyer; title leg `NotApplicable` (never confirmed held; a late hand-over is recovered by redelivery) → `Refunded`.
- **Delivery timeout** (escrow-only, `Funded`, past `deliver_by`): buyer `claim_timeout` → `Refunding`; cash → buyer.
- **Dispute → Refund**: 2-of-3 `Refund` votes → `Refunding` (same as above).

### 5.3 Who reports broadcasts
Anyone may call `report_broadcast`. The contract does not rely on it for correctness — only `confirm_title_transferred` (D-019) completes the leg. It is informational (explorer link for UI).

### 5.4 Escrow-only mode
`title_mode = None`: `Funded → (buyer confirm_delivery) → Settling (cash only, title NotApplicable) → Settled`. Dispute `Release` also settles. eBL mode has no delivery step (D-020).

---

## 6. Failure handling

| Failure | Detection | Recovery |
|---|---|---|
| Verifier transfer fails | Callback error | Leg stays `TransferRequested`; `resume` retries; event emitted |
| MPC sign fails / times out | Callback error or yield timeout | Leg back to `Pending`; executor re-requests with same nonce |
| Recipient rejects title (`rejectTransferOwners`) | Holder = beneficiary = deal address after transfer (visible on Sepolia) | `confirm_title_at_deal_address` (D-019) → entitled party calls `redeliver_title` → same sign/broadcast/confirm flow (D-015) |
| Registry paused by its admin | `RegistryContractPaused` on broadcast/estimate | Leg waits; executor retries after unpause (THREAT_MODEL T14) |
| Tx dropped / underpriced | Not included after N blocks | Re-request signature, same nonce, higher fees |
| Nonce consumed unexpectedly | Executor sees nonce advanced, holder state differs | A party confirms the actual holder state; contract reconciles (Done if destination reached; else re-request with new nonce) |
| Derived address lacks gas | Broadcast rejected | Funder tops up; executor retries |
| A party stays silent | No confirmation | The other two confirm (D-019); disputes + timeouts (T4, T16) |
| Duplicate confirmations | Same fact twice | No-op (idempotent) |
| Relayer down | Users can't submit gasless | Users can call directly with own gas |

Every recovery path is covered by a test (`STATE_MACHINE.md` §6).

---

## 7. Network configuration

| Item | Value |
|---|---|
| NEAR network (demo) | testnet (D-018). No mainnet deployment |
| MPC contract | `v1.signer-prod.testnet` (v3.18.0 on 2026-11-04), secp256k1 `domain_id` 0, deposit 1 yocto, ≥ 15 Tgas |
| Cash rail | Standard CashRail on testnet: own Verifier instance or NEP-141 escrow (V-16); `intents.near` is mainnet-only |
| Contract account / MPC predecessor | `tradelock.samuelowen.testnet` |
| Title chain | Sepolia, chain id 11155111 |
| Derivation path | `tradelock/deal/{deal_id}` (T1 proof: `tradelock/proof/0`) |
| TradeTrust | `@tradetrust-tt/token-registry@5.5.2`; official Sepolia TitleEscrowFactory `0xfcafea839e576967b96ad1FBFB52b5CA26cd1D25` |
| Stablecoin | USDC (exact Intents token id [VERIFY]) |

---

## 8. Diagram for README

```
        CASH LEG (NEAR testnet)                           TITLE LEG (Sepolia)
  Buyer ──USDC──► Verifier (own instance) ──┐     ┌──► TradeTrust TitleEscrow ◄── Supplier's eBL
                                            ▼     ▼
                        ┌──────────────────────────────────┐
                        │      tradelock deal contract      │◄── parties confirm: title held, delivered
                        └──────────────────────────────────┘     (evidence re-checkable on Sepolia)
                                 │                │
       Supplier ◄──USDC──────────┘                └──MPC-signed transfer──► Buyer owns the goods
```
