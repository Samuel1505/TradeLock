# THREAT_MODEL.md — Tradelock

Precise statement of what Tradelock protects, what it trusts, how it can fail, and what it does not claim. Judges reward precision over claims; keep this file accurate as the build changes.

---

## 1. Assets

| Asset | Where | Value at risk |
|---|---|---|
| Buyer's payment | `tradelock`'s Verifier balance | Full deal amount |
| eBL (title to goods) | TitleEscrow on Sepolia, controlled by deal-derived address | Ownership of the cargo |
| Commercial confidentiality | Who trades with whom, amounts, cargo details | Supply chain secrets |
| Deal integrity | State machine on NEAR | Correct release/refund |

## 2. Actors

| Actor | Trusted for | Not trusted for |
|---|---|---|
| Buyer | Their own vote; confirming title held, title received, delivery (D-019) | Anything the supplier is owed |
| Supplier | Their own vote; transferring the eBL in; confirming title returned to them on refund (D-019) | Anything the buyer is owed |
| Arbiter | One vote in disputes; second confirmer of a fact when the protected party is silent (D-019) | Moving funds or confirming a fact alone |
| `tradelock` contract | Enforcing the state machine | — (it is the trust anchor; code is public) |
| MPC network (`v1.signer`) | Signing only what `tradelock` requests; threshold of independent nodes | — (NEAR infrastructure assumption) |
| ~~Shade Agent (TEE)~~ | Cut (D-019, S-10). No attested observer exists in this build | — |
| Sepolia (public chain) | Ground truth for title state; anyone can re-check confirmations against it | — |
| Relayer | Paying gas | Nothing else; restricted to `tradelock` methods |
| Contract owner (us) | Fee bounds, token allowlist, pausing new deals | Moving deal funds or confirming facts — owner has no method to do so |

## 3. Trust assumptions (explicit)

1. NEAR MPC threshold of nodes is honest (shared assumption with all Chain Signatures and NEAR Business).
2. ~~TEE attestation~~ — no longer an assumption (agent cut, D-019). Instead: the party a false confirmation would hurt acts in its own interest, and the arbiter is not colluding with the other party (T7).
3. Each party checks Sepolia itself before confirming (TitleEscrow `holder()` / `beneficiary()`); the contract cannot.
4. eBL mode has no delivery step (D-020). Escrow-only: delivery is whatever the buyer confirms, or what a 2-of-3 dispute decides. No carrier data is used.
5. TradeTrust token-registry contracts behave as published (v5.5.2; registry admin can pause — T14).
6. **Demo-only (S-07):** the testnet Verifier instance `intents.samuelowen.testnet` is operated by us: `samuelowen.testnet` is its super-admin and the account holds a full-access key, so the operator could upgrade or alter the contract holding the cash leg. Production `intents.near` does not have this single-operator trust. The same applies to the test token `tusd.samuelowen.testnet` (owner key held by us).

## 4. Threats and mitigations

| # | Threat | Mitigation | Residual |
|---|---|---|---|
| T1 | Attacker gets contract to sign an arbitrary EVM payload, stealing the eBL | Contract builds the tx itself (fixed `to`, `data`, `value=0`, chain id); caller supplies only nonce + bounded fees; derived address stored from `v1.signer` view, never from a caller (D-013); signature accepted only if `ecrecover` == derived address (D-016) | Bug in tx construction → covered by viem reference-vector tests (unit + nearcore sandbox) |
| T2 | False "title held" to make the buyer's funds releasable without title | Only the buyer can confirm alone (the buyer is the party a false claim hurts); otherwise supplier + arbiter must both confirm; the TitleEscrow address is computed by the contract (D-021) and the expected holder is the stored derived address; evidence is re-checkable on Sepolia | Supplier + arbiter collusion (T7) |
| T3 | False delivery to trigger release before goods arrive | eBL mode: no delivery step (D-020); release is against documents. Escrow-only: only the buyer can confirm delivery; otherwise a 2-of-3 dispute `Release` | Escrow-only: supplier + arbiter collusion (T7) |
| T4 | Buyer stalls to avoid paying | **eBL mode (D-020):** mostly harmless: the buyer cannot collect the cargo without the title, and after `accept_by` anyone may `release` (documents against payment). **Escrow-only:** buyer withholds `confirm_delivery` then claims the `deliver_by` refund; supplier disputes before `deliver_by` (`claim_timeout` is rejected while `Disputed`) and supplier + arbiter vote `Release` | Escrow-only: supplier must dispute before the deadline |
| T5 | Supplier never ships after buyer funds | `ship_by` timeout → buyer refund | Buyer's capital locked until deadline |
| T6 | Settlement stuck halfway (cash paid, title not moved) | Legs tracked separately; resumable; MPC key persists; anyone can `resume` | Sepolia outage delays completion; no loss |
| T7 | Arbiter colludes with one party | Arbiter needs one party's vote; parties choose arbiter jointly | Collusion of arbiter + one party wins the dispute (inherent to 2-of-3) |
| T8 | Replay of an old signature | Each signature binds a nonce; at most one tx per nonce lands | — |
| T9 | Double funding / wrong token | `mt_on_transfer` validates exact token and amount; refunds mismatch | — |
| T10 | Relayer abuse (gas drain) | Method allowlist, per-account rate limits | Spam within limits |
| T11 | Owner key compromise | Owner cannot move deal funds, sign title txs, or confirm facts | Could pause new deals or change fee bounds/token allowlist |
| T12 | Document check used to approve bad goods | Check is advisory; never gates transitions | Humans may over-trust the badge |
| T13 | Linkage of deals on Sepolia | Fresh derived address per deal; only document hash on-chain | **Gas funder links deal addresses** (one funder tops up all) |
| T14 | Registry admin (carrier) pauses the TradeTrust registry, freezing the title leg | Timeouts still return cash; legs resume after unpause. Same trust any eBL holder places in the issuing carrier's registry | Title frozen while paused |
| T15 | Recipient calls `rejectTransferOwners` after settle/refund, returning title to the deal address | `redeliver_title` (D-015): once the title is confirmed back at the deal address (entitled party alone, or the other two, D-019), the entitled party (buyer after Settled, supplier after Refunded) re-triggers the same sign/broadcast/confirm flow to the same stored address; no caller-supplied address | Recipient can loop reject/redeliver; costs only them and executor gas |
| T16 | Buyer refuses to confirm title held although the supplier handed it over, then claims the `ship_by` refund | Supplier + arbiter confirm title held before `ship_by`; if refunded anyway, the supplier alone confirms the title is at the deal address and redelivery returns it (D-015/D-019) | Supplier must act; title temporarily at the deal address |
| T17 | Goods do not match the order (quality, quantity) | None in the protocol, as in bank D/P: the buyer pays against documents. The buyer can `refuse_documents` within the window or dispute before release, but nothing inspects goods | **Not protected.** Inspection certificates as a release condition are on the roadmap |
| T18 | Buyer refuses documents opportunistically (e.g. price moved) | Same as real D/P: refusal returns cash and title; supplier keeps control of the goods via the title | Supplier bears shipping cost/time; choose counterparties accordingly |

## 5. Privacy model

### Private (as built)
- Document contents: only hashes stored anywhere on-chain.
- Cargo details: never on-chain.

### Not private in this build (D-018)
- Cash leg amounts and counterparties are **public** on NEAR testnet: the Standard CashRail holds plain balances. Confidential Intents (which would unlink deposit and payout) is mainnet-only and cut; the design is in NEAR_INTEGRATION §3 and is not claimed.

### Design target (not live)
- With a Confidential rail, buyer deposit and supplier payout could not be linked on-chain, and amounts/counterparties would leave public view, subject to D-010 (contract storage and call args are public).

### Also private

- Cargo details: never on-chain.

### Public by design
- Existence of a deal on NEAR, its state transitions and votes (verifiable governance, as in NEAR Business).
- On Sepolia: that a TitleEscrow holder/beneficiary transfer occurred to/from a deal address.
- Destination-chain payout, if the supplier withdraws to a public chain address.

### Known leaks
- Gas funding of deal-derived addresses from a single funder (T13).
- Timing correlation between NEAR state events and Sepolia transfers for the same deal (events reference deal id only; correlation is still possible by timing).
- The Standard cash rail (the only rail in this build) makes cash-leg amounts and parties public.

## 6. Out of scope / not claimed

- **Cross-chain atomicity.** Settlement is orchestrated, not atomic. The contract holds both legs before either moves.
- **Legal validity.** Whether a 2-of-3 contract controlling an address via MPC satisfies MLETR "exclusive control" is an open question this design raises.
- Physical verification of goods, quality inspection, customs. Like bank D/P, release is against documents, not inspection (D-020, T17); inspection certificates are on the roadmap.
- KYC/AML, sanctions screening, licensing.
- Fiat on/off-ramps.
- Production key management for the contract owner.

## 7. Demo-specific substitutions
See `SUBSTITUTIONS.md`. The carrier role (eBL issuance) is performed by our own deployment of the real TradeTrust contracts on Sepolia.
