# agent — cut

The Shade Agent is cut (docs/DECISIONS.md D-019, docs/SUBSTITUTIONS.md S-10): Phala Cloud needs a card, the
framework is unmaintained since 2026-04-19, and its local mode verifies no attestation.

Title and delivery facts are confirmed by the deal parties instead. The executor steps (nonce/fee lookup,
signature request, broadcast, holder/beneficiary check) live in `scripts/` and can be run by any party.
