# SUBSTITUTIONS.md — Tradelock

Every place where a real-world dependency is replaced by something else in the demo. Rule (CLAUDE.md §2): never silently mock. If it isn't listed here and in the README, it must be real.

Format:
```
## S-NN — What is substituted
Real thing: ...
Used instead: ...
Why: ...
How a judge can tell: ...
Path to the real thing: ...
```

---

## S-01 — eBL issuance (carrier role)
Real thing: An ocean carrier (or its eBL platform) issues the electronic bill of lading.
Used instead: We deploy the real TradeTrust token-registry contracts on Sepolia and mint eBLs from our deployer account acting as the carrier.
Why: No carrier will issue a real eBL for a hackathon demo; TradeTrust contracts are the real, MLETR-oriented framework.
How a judge can tell: Registry and minter addresses listed in `DEPLOYMENTS.md`; minter is our deployer. The TitleEscrow factory is TradeTrust's own official Sepolia deployment `0xfcafea839e576967b96ad1FBFB52b5CA26cd1D25` (D-014), so every TitleEscrow is created by TradeTrust's factory; only the registry is ours.
Consequence: because we deploy the registry, **we hold its `DEFAULT_ADMIN_ROLE`** (and minter/restorer/accepter roles). The admin can `pause` the registry and freeze all title transfers (THREAT_MODEL T14). In the real world the carrier holds this role; Tradelock users would trust the issuing carrier exactly as they do today.
Path to the real thing: Carriers or eBL platforms issuing on TradeTrust registries; Tradelock only needs the registry address and token id.

## S-02 — Title chain is Sepolia, not mainnet
Real thing: TradeTrust eBLs on Ethereum, Polygon, or XDC mainnet.
Used instead: Sepolia testnet.
Why: Testnet eBLs carry no legal weight and cost nothing; the signing flow is identical.
How a judge can tell: Chain id 11155111 in every title tx.
Path to the real thing: Change chain id and registry address per deal.

## S-03 — Carrier tracking data source
Real thing: Carrier Track & Trace events for the B/L or container.
Used instead: None. With the agent cut (S-10), no tracking feed is read; the buyer confirms delivery (D-019).
Why: Nothing in the build could attest a feed without a TEE.
How a judge can tell: No tracking API keys or calls in the repo.
Path to the real thing: An attested agent reading a carrier API (CLAUDE.md §8 design).

## S-04 — Commercial documents
Real thing: Real invoices and packing lists.
Used instead: Synthetic documents generated for the demo.
Why: Never use real commercial or personal data.
How a judge can tell: Documents marked "SAMPLE" in `scripts/demo/fixtures`.
Path to the real thing: Parties upload their own documents.

## S-05 — Test-only mocks
Real thing: `v1.signer` (MPC).
Used instead: `MockSigner` (`contracts/mocks/mock-signer`) in `near-workspaces` sandbox tests only: same request/response shapes and the same epsilon derivation as near/mpc, fixed public root key, synchronous answer. No MockVerifier: sandbox tests run the real Verifier WASM (`defuse` v0.4.5). Unit tests sign with a local key (`mock_mpc_response`). Real-MPC proof: T1 on testnet (DEPLOYMENTS.md).
Why: Sandbox has no Verifier or MPC; testnet runs use the real `v1.signer-prod.testnet` MPC and the cash rail in S-07.
How a judge can tell: Mocks live only under `contracts/*/tests`; never deployed.

## S-06 — NEAR testnet instead of mainnet (D-018)
Real thing: Tradelock on NEAR mainnet with `v1.signer`, `intents.near`, real stablecoins.
Used instead: NEAR testnet: `tradelock.samuelowen.testnet`, MPC `v1.signer-prod.testnet`.
Why: No real funds in the demo; MPC sign interface is identical across 3.17.0 (mainnet) and 3.18.0 (testnet) (V-01).
How a judge can tell: Explorer links point to testnet.nearblocks.io; `.env.example` sets `NEAR_NETWORK=testnet`.
Path to the real thing: Redeploy to mainnet with `v1.signer`; derived addresses change with the predecessor and MPC root key.

## S-07 — Cash rail on testnet
Real thing: `intents.near` Verifier holding a real stablecoin (e.g. USDC) as NEP-245 balances.
Used instead: **Our own testnet instance of the real `near/intents` Verifier** (`defuse` v0.4.5, commit 16d04f6, built from source by `scripts/cashrail/build-verifier.sh`) on `intents.samuelowen.testnet` (decision 2026-11-04; deployment pending funding), holding a **test stablecoin**: `tusd.samuelowen.testnet`, the upstream `near/intents` `releases/fungible-token.wasm` initialised as "Tradelock Test Dollar (testnet, no value)", symbol `tUSD`, 6 decimals. Fallback if the Verifier cannot be funded: plain NEP-141 escrow (`ft_transfer_call`), disclosed here. Deployed 2026-11-06 (DEPLOYMENTS.md).
**Single-operator trust (demo only):** on our instance `samuelowen.testnet` is the Verifier's super-admin (`roles.super_admins` at init) and `intents.samuelowen.testnet` holds a full-access key. The operator could therefore upgrade, pause or alter the contract that holds the cash leg, including balances. The production `intents.near` does not carry this single-operator trust. This is a demo-only substitution; nothing on this instance has value (test token).
Why: `intents.near` has no testnet deployment.
How a judge can tell: Verifier/token account ids and code hashes in `DEPLOYMENTS.md`.
Path to the real thing: Point `CashRail::Standard` at `intents.near` and a real token id on mainnet.

## S-08 — Confidential Intents cut
Real thing: Confidential Intents (unlinkable deposit/payout on the confidential shard).
Used instead: Nothing. Cash leg is public on testnet.
Why: Mainnet-only (D-018).
How a judge can tell: README and THREAT_MODEL state cash-leg amounts and parties are public; NEAR_INTEGRATION §3 is marked "cut".
Path to the real thing: `CashRail::Confidential` per NEAR_INTEGRATION §3 on mainnet, after D-010.

## S-09 — NEAR AI Cloud document check cut
Real thing: Advisory comparison of invoice/packing list against the order, run on NEAR AI Cloud TEE inference with verified attestation (CLAUDE.md §9).
Used instead: Nothing. No document check runs; nothing claims one did, and no "verified private" badge is shown.
Why: NEAR AI Cloud has no free tier or credits (V-13); buying credits was not approved (2026-11-04).
How a judge can tell: No `NEAR_AI_*` variables in `.env.example`; no `/api/doc-check` route; README limitations and How-it-uses-NEAR table say "cut".
Path to the real thing: Buy credits (est. cents for a demo at $0.30/$1.20 per 1M tokens on `deepseek-ai/DeepSeek-V4.1-Flash-1017`) and implement CLAUDE.md §9; it never gates a state transition.

## S-10 — Shade Agent cut: facts confirmed by the parties
Real thing: A TEE-attested Shade Agent (Phala Cloud) reporting title-held, title-transferred and arrival facts; the contract accepts them only from approved code.
Used instead: **No agent.** Title receipt is confirmed by the parties and delivery by the buyer (D-019): the party a false confirmation would hurt may confirm alone; otherwise the other two parties must confirm identical evidence (tx hash, block, holder, beneficiary). Title signing requests and Sepolia broadcasts are run by any party with `scripts/` (untrusted: the contract builds the tx).
Why: Phala Cloud requires a card (none available); the Shade Agent Framework is unmaintained since 2026-04-19; its local mode verifies no attestation, so it is not used as a substitute (V-17).
How a judge can tell: No `contracts/tradelock-agent`, no TEE deployment, `agent/` is a placeholder; methods are `confirm_*` callable by parties; every confirmation's evidence can be re-checked on Sepolia (README "Verify title yourself").
Path to the real thing: Re-introduce an attested observer as an additional confirmer (CLAUDE.md §8 design) without changing the state machine.

## S-NN — (add any further substitution here, including fallbacks from the cut order)
Examples that must be recorded if they happen: Standard Intents instead of Confidential Intents; buyer-confirmed delivery instead of the Shade Agent; party-confirmed title receipt instead of agent attestation.
