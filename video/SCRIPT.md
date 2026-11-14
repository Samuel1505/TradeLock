# Tradelock demo — script and shot list (draft 2)

Style follows the reference video: 16:9, first-person voiceover in Samuel's cloned voice, one caption line at the bottom with key words lit in colour as they are spoken, real app screens with a cursor driving them, a few big kinetic-type beats, soft music bed under the voice, end card with URL + GitHub.

Target: ~90 s (CLAUDE.md §12), ~225 words.

| # | Time | Voiceover | Picture |
|---|---|---|---|
| 1 | 0–8 | Cross-border trade has a trust problem. The supplier won't ship before they're paid. The buyer won't pay before they own the goods. | Diagram: two cards, BUYER and SUPPLIER, facing each other; a cargo box and a coin both stuck in the middle, shaking. |
| 2 | 8–17 | Banks fix this by holding the bill of lading until the buyer pays. It's slow, it's expensive, and forty-one percent of small businesses' trade finance applications get turned down. | Diagram: bank icon becomes a gate. Big "41%" counts up; small line "of SME trade finance applications rejected · ADB". |
| 3 | 17–23 | So I built Tradelock. Goods for money, exchanged by a contract. No bank needed. | Logo lockup, kinetic type on "*exchanged*". Stamp: "NO BANK". |
| 4 | 23–33 | The buyer proposes a deal, the supplier accepts, and the buyer's stablecoins move into the contract through NEAR Intents. The contract holds them, and only its rules can release them. | As built: deal 4 was run from the terminal (`pnpm demo settle --step`); the real runner output types in beside screenshots of the live `/deals/4` page taken after each step (Created → Funded). No cursor clicks are shown, because none happened in the browser. |
| 5 | 33–47 | Then the supplier hands over the electronic bill of lading, the title to the cargo, to a Sepolia address that only this NEAR contract controls, through Chain Signatures. | The main shot. The eBL card travels from the supplier wallet to the deal address; TitleEscrow `holder()` / `beneficiary()` morph to the deal address. Caption: "an address only NEAR MPC can sign for". Real hand-over tx hash from deal 4. |
| 6 | 47–55 | The buyer checks the title on Sepolia. If the documents are right, they accept. | Deal 4 page: checklist ticks (cash locked, holder = deal, beneficiary = deal); cursor clicks "Accept documents". |
| 7 | 55–67 | And both legs move. The contract pays the supplier, builds the title transfer itself, and NEAR's MPC network signs it over to the buyer. | Split: cash leg → supplier ✓, title leg → buyer ✓, deal 4's real tx hashes. Caption under the split: "The contract already holds the title, so paying first is safe." Then the "RELEASED" stamp. |
| 8 | 67–77 | Documents wrong? Refuse them, and cash and title both go back. Disagree? Buyer, supplier and arbiter vote, and two of three decide. | Deal 1 (refused): both cards return, labelled "deal 1". Deal 3: vote chips Refund / Release / Release, bar fills 2 of 3, labelled "deal 3". |
| 9 | 77–85 | Every deal you saw is real, on NEAR testnet and Sepolia: settled, refunded, disputed, escrow-only. Check the title yourself. | Deals 0–4 list with status badges, deal 4 tagged "this video"; `TitleEscrow.holder() → buyer` highlighted with its Etherscan link. |
| 10 | 85–90 | The buyer only gets the goods when the seller gets paid. And no bank is needed. | End card: logo, the line, GitHub link, "Built on NEAR · NEAR HACKATHON · Real-World Money", small "Testnet demo · disclosures in README". |

## Accuracy notes
- "Title to the cargo" / "document of title", never "legal title": no legal-validity claim (CLAUDE.md §10).
- Says testnet + Sepolia; no mainnet claim.
- Never "atomic", "together", or "at the same time" for the two legs.
- ADB figure is 41% of SME trade finance *applications*, not of businesses.
- MPC signs only transfers out of the deal address; the supplier signs the hand-over in.
- Every on-screen action happened on-chain. Anything that didn't (rows 1–2) is labelled as a diagram.
- Tx hashes and addresses come from `docs/DEPLOYMENTS.md` only; deal 4's are added there when it runs.
