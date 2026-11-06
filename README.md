# Tradelock

**The buyer only gets the goods when the seller gets paid — and no bank is needed.**

Tradelock is bankless documents-against-payment for cross-border trade, built on NEAR. A buyer's stablecoins and a supplier's electronic bill of lading (legal title to the shipped goods) are locked in one deal. When delivery is confirmed, the deal releases both: payment to the supplier, title to the buyer.

Runs on **NEAR testnet + Sepolia** (no mainnet deployment).

Built at NEAR HACKATHON. Track: Real-World Money.

> **Status:** the title-leg proof (T1) is done on testnet and linked below. The deal contract is built and tested (unit + sandbox with the real Verifier code) but not yet deployed; the demo is in progress. Sections marked `TODO` are not claimed.

---

## The problem

- Cross-border trade has a first-mover problem: suppliers won't ship before payment; buyers won't pay before owning the goods.
- Banks solve it by holding the bill of lading until the buyer pays (documents against payment, letters of credit). It is slow and costly, and small businesses are often refused: the Asian Development Bank reports SME trade finance applications are rejected ~41% of the time, within a ~$2.5T global trade finance gap.
- Without a bank, small traders prepay and hope, or send final, public stablecoin payments that expose their suppliers and volumes.

## What Tradelock does

Like a bank's documents-against-payment, but without the bank:

1. Buyer and supplier agree terms; the buyer locks stablecoins in the deal.
2. The supplier ships and transfers the eBL (the title to the cargo) to an address only the deal controls.
3. The buyer checks the title on Sepolia and confirms it is held (if the buyer stays silent, supplier + arbiter can confirm instead).
4. The buyer accepts the documents → the deal pays the supplier and transfers the title to the buyer, who collects the cargo with it. The buyer may refuse the documents within the acceptance window → cash back to the buyer, title back to the supplier. Silence past the window → anyone can release.
5. Disputes: 2 of 3 (buyer, supplier, arbiter) decide.
6. No eBL? The same deal runs as stablecoin escrow, released when the buyer confirms delivery.

---

## Try it

Status: steps 1–3 work today; steps 4–7 need the Verifier deployed (`intents.samuelowen.testnet`, pending funding) and the demo accounts' keys in your OS keychain (`near` CLI). Until then, `pnpm demo …` without `--yes` prints the exact next command and stops.

Demo runner (`scripts/demo/run.ts`): state-driven, one step per pass, prints every command, sends only with `--yes`, resumable with `--deal N`:
```
pnpm demo settle            # dry run: prints the next command (create_deal) and stops
pnpm demo settle --yes      # eBL: create → accept → fund → mint eBL → hand over → confirm held → accept documents → MPC-signed title transfer → Settled
pnpm demo refund --yes      # eBL: … → refuse documents → cash back + MPC-signed title back to supplier → Refunded
pnpm demo escrow --yes      # escrow-only: … → confirm delivery → ft_withdraw payout to the supplier → Settled
pnpm demo settle --deal 3 --yes   # resume a deal from its on-chain state
```
Web app: `cp web/.env.example web/.env.local && pnpm --filter @tradelock/web dev` → http://localhost:3000 (deal page at `/deals/<id>`, judge view at `/demo`).

Target shape:

1. `git clone … && cd tradelock && cp .env.example .env` → fill values (see `.env.example`).
2. `pnpm install && cargo near build` → contracts build without errors.
3. `pnpm test` and `cargo test` → all state-machine, idempotency, and tx-construction tests pass.
4. `pnpm demo:settle` → prints a deal id, the deal-derived Sepolia address, and explorer links; ends with state `Settled`.
5. Open the printed Sepolia link → see the TitleEscrow holder and beneficiary change from the deal address to the buyer.
6. Open the printed NEAR link → see the payout to the supplier and the `deal_settled` event.
7. `pnpm demo:refund` → same flow ending in `Refunded`, with title back with the supplier.

Recorded run and all addresses: [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md).

### Proof so far: a NEAR contract moved title to goods on Sepolia (T1)

1. Our TradeTrust registry minted an eBL; TradeTrust's official factory created its TitleEscrow [`0x9E54…f193`](https://sepolia.etherscan.io/address/0x9E549E4467e013e71F87402CBDc5c6E438E7f193) ([mint](https://sepolia.etherscan.io/tx/0x4be2fc58d490f8fd9e01616c6c3bbffd1c9afdf645d75e80e5663afbb63acc94)).
2. The supplier handed holder + beneficiary to `0x4C1f…7a628`, the address `v1.signer-prod.testnet` derives for `tradelock.samuelowen.testnet` + path `tradelock/proof/0` ([hand-over](https://sepolia.etherscan.io/tx/0x8e5f9579061fa63c011d4fceb899c8f78f6d0cd3c316d6ace4c08d61f2037bba)).
3. The contract built the `transferOwners(buyer, buyer, 0x)` transaction itself and requested an MPC signature ([NEAR tx](https://testnet.nearblocks.io/txns/HJyWxZri6st1SkKoJiJmFFM4qFQeHbfZG4uWu5KeGmWN)); its callback checked with `ecrecover` that the signer is the derived address.
4. The signed transaction was broadcast to Sepolia ([title transfer](https://sepolia.etherscan.io/tx/0x0430ac7a831670fbd34cbea42b1759552977cbb1ad43ef7ab5ccf782fc84cd5d)); holder and beneficiary are now the buyer `0x6a7d…46ed`.

Reproduce with your own accounts: `pnpm evm:deploy-registry && pnpm evm:mint && pnpm evm:hand-over`, deploy `contracts/tradelock-proof` (commands in `docs/DEPLOYMENTS.md`), then `pnpm t1:derive`, `pnpm t1:prepare`, `request_signature`, `pnpm t1:broadcast`.

### Verify title yourself (no trust in Tradelock needed)

Title state lives on Sepolia, not in our contract. For any deal, read the TitleEscrow directly:

```
cast call <TitleEscrow> "holder()(address)"      --rpc-url https://ethereum-sepolia-rpc.publicnode.com
cast call <TitleEscrow> "beneficiary()(address)" --rpc-url https://ethereum-sepolia-rpc.publicnode.com
cast call <registry> "ownerOf(uint256)(address)" <tokenId> --rpc-url …   # returns the TitleEscrow
```

For the T1 proof: TitleEscrow [`0x9E549E4467e013e71F87402CBDc5c6E438E7f193`](https://sepolia.etherscan.io/address/0x9E549E4467e013e71F87402CBDc5c6E438E7f193) returns `0x6a7d2cF926879f23692ab6058258D1Eb7c3E46ed` for both. The explorer page's event log shows every `HolderTransfer` / `BeneficiaryTransfer`. Each deal page and `docs/DEPLOYMENTS.md` link the deal's TitleEscrow; every party confirmation stores the tx hash and block, so anyone can check it against this chain state.

---

## How it uses NEAR

| Primitive | Exact job in Tradelock |
|---|---|
| SputnikDAO-style 2-of-3 approvals (implemented natively in `tradelock`) | Buyer, supplier, and arbiter vote to release or refund both legs in disputes |
| Chain Signatures (`v1.signer-prod.testnet`) | The deal contract controls a per-deal Sepolia address that holds the eBL, and signs its transfer to the buyer or back to the supplier |
| NEAR Intents Verifier | Holds the buyer's stablecoins as the contract's balance; pays the supplier or refunds the buyer. On testnet: our own instance or a NEP-141 escrow (`docs/SUBSTITUTIONS.md` S-07) |
| Confidential Intents | **Not used.** Mainnet-only; this build runs on testnet. Design documented in `docs/NEAR_INTEGRATION.md` §3 |
| Shade Agents | **Not used (cut).** Phala Cloud needs a card and the framework is unmaintained; title and delivery facts are confirmed by the parties instead (`docs/SUBSTITUTIONS.md` S-10) |
| NEAR AI Cloud | **Not used (cut).** Designed as an advisory invoice/packing-list check inside a TEE; no free credits were available (`docs/SUBSTITUTIONS.md` S-09) |
| Meta transactions | Relayer pays gas so traders never need NEAR |

Track hints used — Real-World Money: Stablecoins, NEAR Intents (Verifier on testnet), Meta Transactions.

**Why this is only possible on NEAR:** a NEAR contract holds title to physical goods on another chain through MPC, and settles it against payment in the same deal.

---

## Architecture

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

Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## State machine

eBL mode: `Created → Funded → TitleHeld → (accept documents | window lapses) → Settling → Settled`; refusing documents → `Refunding → Refunded`. Escrow-only: `Funded → (buyer confirms delivery) → Settling → Settled`. Plus `Disputed` (2-of-3 votes) and `Cancelled`. Every step is idempotent and resumable; each leg is tracked separately so a failed signature or dropped transaction never leaves a deal half-settled. Full spec: [`docs/STATE_MACHINE.md`](docs/STATE_MACHINE.md).

---

## Privacy: what is and isn't private

- **Private:** document contents (only hashes on-chain); cargo details.
- **Public in this build:** cash-leg amounts and counterparties (Standard rail on testnet; Confidential Intents is mainnet-only and not used).
- **Public by design:** deal existence, state transitions and votes on NEAR; that a title transfer happened on Sepolia (fresh address per deal).
- **Known leaks:** gas funding links deal addresses on Sepolia; timing correlation between NEAR events and Sepolia transfers.

Full threat model: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Known limitations

- Settlement is orchestrated across two chains, **not atomic**. The contract holds both assets before either moves.
- eBL adoption is early (~13% of bills of lading in 2025; ~11 MLETR jurisdictions). Escrow-only mode serves most trade today.
- **No protection against non-conforming goods.** As in bank D/P, payment is released against documents, not inspection. The buyer can refuse the documents within the window or dispute, but nothing checks the cargo (THREAT_MODEL T17).
- **Open legal question:** whether an address controlled by a 2-of-3 contract via MPC satisfies MLETR "exclusive control." Not claimed.
- Demo substitutions (carrier role, Sepolia, NEAR testnet, own Verifier instance, no agent, synthetic documents): [`docs/SUBSTITUTIONS.md`](docs/SUBSTITUTIONS.md).
- No fiat ramps, KYC, licensing, or production key management.
- **NEAR AI Cloud document check is cut**: NEAR AI Cloud has no free tier or credits, and no paid credits were bought. Commercial documents are not checked automatically; parties review them themselves (S-09).
- **Confidential Intents is not used** (mainnet-only); cash-leg amounts and parties are public in this build (S-08).
- **No attested agent** (S-10): title facts are confirmed by the parties (the party a false confirmation would hurt, or the other two together), re-checkable on Sepolia. eBL mode has no delivery step (D/P). In escrow-only mode a supplier facing a silent buyer must open a dispute before the delivery deadline.

## Tests

Run now (T1 scope):
- `cd contracts && cargo test` → in-contract EIP-1559 payload == viem reference vectors (3 cases incl. `u128::MAX` fees); derived address from `v1.signer` key == chainsig.js; every `request_signature` guard; MPC response parsing; wrong-key and high-s signatures rejected via `ecrecover`; fee bump; nearcore sandbox load of the built WASM; the real NEAR Intents Verifier (`defuse` v0.4.5, built by `scripts/cashrail/build-verifier.sh`) initialising and running deposit → `mt_transfer_call` (accept + refund) → `mt_transfer` → `ft_withdraw`.
- `pnpm --filter @tradelock/evm test` → TradeTrust 5.5.2 bytecode on anvil: deploy, mint, one-call `transferOwners` hand-over and onward transfer, recipient `rejectTransferOwners` (T15).
- `RUN_NETWORK_TESTS=1 pnpm --filter @tradelock/shared test` → live testnet: chainsig.js == `v1.signer-prod.testnet.derived_public_key` == address stored by the deployed contract.

- `cd contracts && cargo test -p tradelock` → the deal contract: 82 unit tests (every transition and guard in `docs/STATE_MACHINE.md`, idempotency, documents-against-payment windows, 2-of-3 votes, party confirmations, cash failure + resume, title signing with `ecrecover`, redelivery) and 3 sandbox E2E tests on the real nearcore runtime with the real Verifier code: accept documents → `Settled`, refuse → `Refunded`, silent window → `release`, escrow-only with `ft_withdraw` payout, mismatched funding refunded, MPC failure then retry. Sandbox signing uses `MockSigner` (test-only; the real MPC is proven by T1).
- `pnpm --filter @tradelock/web e2e:deployed` (with the web app running) → headless Chromium, no wallet, against the deployed testnet contracts: `/deals/0` (Settled) and `/deals/1` (Refunded) in light, dark and mobile show the right state, path-specific timeline, seal, live Sepolia holder/beneficiary, legs, confirmations and links, with no action buttons, no console errors and no horizontal scroll; `/demo` lists both (74 checks).
- Prerequisites for sandbox tests: `scripts/cashrail/build-verifier.sh`, then `cargo near build non-reproducible-wasm` in `contracts/tradelock` and `contracts/mocks/mock-signer` (`--no-abi`).

`TODO`: testnet deployment of the deal contract and Verifier; end-to-end demo script.

## Roadmap

- Fully confidential title leg.
- Inspection certificates (third-party inspector attestation) as an optional release condition.
- Receivables financing on funded, title-backed deals.
- NEAR Business treasury integration (fund deals from a treasury; pay out to business.near.com accounts).

## Design decisions

[`docs/DECISIONS.md`](docs/DECISIONS.md)
