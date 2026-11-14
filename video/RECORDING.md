# Recording deal 4 (browser + terminal)

Every step is a real testnet / Sepolia transaction. Run each command yourself; nothing is sent without `--yes` / `--step`.
Screen-record the whole run (macOS: Cmd+Shift+5 → Record Entire Screen). Browser and terminal side by side, browser zoom 125%, dark mode.

## Off camera
1. `pnpm demo prep` → dry run, prints what it would send. Then `pnpm demo prep --yes` → buyer's tUSD is in the Verifier.
2. Export keys yourself (not to Claude) and import into a testnet wallet supported by near-connect (e.g. Meteor or MyNearWallet testnet):
   `near account export-account buyer.samuelowen.testnet using-private-key network-config testnet` (same for `supplier.samuelowen.testnet`).
3. Start the app: `pnpm --filter @tradelock/web build && pnpm --filter @tradelock/web start` → http://localhost:3000.

## On camera
| # | Who | Where | Action | Script row |
|---|---|---|---|---|
| 1 | buyer | browser `/deals/new` | Fill: supplier `supplier.samuelowen.testnet`, arbiter `arbiter.samuelowen.testnet`, amount `1.00`, Bill of lading, registry (default), eBL token id `21479435288809577532764151913566032738384361232369017706679301492587056062539`, your EVM `0x6a7d2cF926879f23692ab6058258D1Eb7c3E46ed`, supplier EVM `0xefbC93fC249040e533D8191Def10DC58D4108717`, window `0.05` h (3 min), a synthetic order file → Create. Should become deal 4. | 4 |
| 2 | supplier | browser `/deals/4` | Accept deal. | 4 |
| 3 | buyer | browser `/deals/4` | Fund. → Funded. | 4 |
| 4 | carrier + supplier | terminal | `pnpm demo settle --deal 4 --step` → mint eBL. Repeat `--step` → supplier hands title to the deal address. | 5 |
| 5 | buyer | browser `/deals/4` | Confirm title held (page shows Sepolia `holder()` / `beneficiary()`). → TitleHeld. | 6 |
| 6 | buyer | browser `/deals/4` | Accept documents. → Settling. | 6–7 |
| 7 | executor | terminal | `pnpm demo settle --deal 4 --step` → gas top-up + MPC signature + broadcast + report. | 7 |
| 8 | buyer | browser `/deals/4` | Confirm title received. → Settled. | 7 |

After: add deal 4's txs to `docs/DEPLOYMENTS.md` (`docs/demo-runs/settle-deal-4.json`).
