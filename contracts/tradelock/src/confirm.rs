//! Party confirmations of facts the contract cannot read (D-019, D-021; STATE_MACHINE §5a) and
//! redelivery after a rejected title (D-015).

use crate::*;

/// The fact that can be confirmed in the deal's current state, if any.
pub(crate) fn open_fact(d: &Deal) -> Option<Fact> {
    d.ebl()?;
    match d.state {
        DealState::Funded => Some(Fact::TitleHeld),
        DealState::Settling | DealState::Refunding if !d.title.is_complete() => Some(Fact::TitleTransferred),
        DealState::Settled | DealState::Refunded => match &d.redelivery {
            Some(r) if r.requested && r.leg != TitleLeg::Done => Some(Fact::TitleTransferred),
            Some(r) if !r.requested && r.leg != TitleLeg::Done => None, // returned; awaiting redeliver_title
            _ => Some(Fact::TitleAtDealAddress),
        },
        _ => None,
    }
}

/// The party a false confirmation would hurt: may confirm alone.
pub(crate) fn protected_party(d: &Deal) -> Party {
    match d.state {
        DealState::Refunding | DealState::Refunded => Party::Supplier,
        _ => Party::Buyer,
    }
}

/// Fact already accepted for the current state → repeated confirmation is a no-op.
fn already_accepted(d: &Deal, fact: Fact) -> bool {
    match fact {
        Fact::TitleHeld => d.ebl().is_some() && matches!(d.state, DealState::TitleHeld | DealState::Settling | DealState::Settled)
            || (d.disputed_with_title && d.state == DealState::Disputed),
        Fact::TitleTransferred => match d.state {
            DealState::Settling | DealState::Refunding => d.title == TitleLeg::Done,
            DealState::Settled | DealState::Refunded => d.redelivery.as_ref().is_none_or(|r| r.leg == TitleLeg::Done),
            _ => false,
        },
        Fact::TitleAtDealAddress => matches!(&d.redelivery, Some(r) if r.leg != TitleLeg::Done),
    }
}

impl Tradelock {
    fn confirm(&mut self, deal_id: U64, fact: Fact, evidence: Evidence) -> bool {
        let mut deal = self.load(deal_id.0);
        let party = deal.party_of(&env::predecessor_account_id()).unwrap_or_else(|| fail("Unauthorized", "not a deal party"));
        if deal.ebl().is_none() {
            fail("InvalidState", "escrow-only deal has no title facts");
        }
        if evidence.block_number.0 == 0 {
            fail("InvalidTerms", "evidence.block_number must be > 0");
        }
        if let Some(h) = &evidence.tx_hash {
            if !(h.len() == 66 && h.starts_with("0x") && h[2..].bytes().all(|b| b.is_ascii_hexdigit())) {
                fail("InvalidTerms", "evidence.tx_hash must be 0x + 64 hex");
            }
        }
        if open_fact(&deal) != Some(fact) {
            if already_accepted(&deal, fact) {
                return false; // idempotent
            }
            fail("InvalidState", format!("{fact:?} cannot be confirmed in state {:?}", deal.state));
        }
        // D-019: the attested holder and beneficiary must both equal the address this fact expects.
        let expected = match fact {
            Fact::TitleHeld | Fact::TitleAtDealAddress => deal.ebl().and_then(|t| t.derived_address),
            Fact::TitleTransferred => deal.title_dest(),
        }
        .unwrap_or_else(|| fail("DerivedAddressMissing", "expected address unknown"));
        let holder = parse_address(&evidence.holder).unwrap_or_else(|e| fail("EvidenceMismatch", format!("holder: {e}")));
        let beneficiary = parse_address(&evidence.beneficiary).unwrap_or_else(|e| fail("EvidenceMismatch", format!("beneficiary: {e}")));
        if holder != expected || beneficiary != expected {
            fail("EvidenceMismatch", format!("holder and beneficiary must both be {}", to_hex(&expected)));
        }
        if fact == Fact::TitleHeld {
            let ship_by = deal.ebl().map(|t| t.ship_by).unwrap_or(0);
            if env::block_timestamp() >= ship_by {
                fail("DeadlinePassed", "ship_by passed");
            }
        }
        if deal.pending_fact != Some(fact) {
            deal.pending_fact = Some(fact);
            deal.pending_confirmers.clear();
        }
        let protected = protected_party(&deal);
        let accepted = if party == protected {
            true
        } else {
            if deal.pending_confirmers.contains(&party) {
                return false; // same party twice: no-op
            }
            deal.pending_confirmers.push(party);
            deal.pending_confirmers.iter().filter(|p| **p != protected).count() >= 2
        };
        deal.confirmations.push(ConfirmationRecord { fact, party, evidence: evidence.clone(), at: U64(env::block_timestamp()), accepted });
        if deal.confirmations.len() > MAX_CONFIRMATION_RECORDS {
            deal.confirmations.remove(0);
        }
        emit("confirmation", json!({ "deal_id": deal_id, "fact": fact, "party": party, "evidence": evidence, "accepted": accepted }));
        if accepted {
            deal.pending_fact = None;
            deal.pending_confirmers.clear();
            self.apply_fact(&mut deal, fact);
        }
        self.save(deal);
        accepted
    }

    fn apply_fact(&mut self, deal: &mut Deal, fact: Fact) {
        match fact {
            Fact::TitleHeld => {
                let now = env::block_timestamp();
                let t = deal.ebl_mut().expect("ebl");
                t.accept_by = Some(now.saturating_add(t.doc_acceptance_window_ns));
                let accept_by = t.accept_by;
                Self::transition(deal, DealState::TitleHeld, "title_held");
                emit("documents_presented", json!({ "deal_id": U64(deal.id), "accept_by": accept_by.map(U64) }));
            }
            Fact::TitleTransferred => match deal.state {
                DealState::Settling | DealState::Refunding => {
                    deal.title = TitleLeg::Done;
                    emit("title_leg_progress", json!({ "deal_id": U64(deal.id), "leg": LegKind::Main, "status": "Done" }));
                    Self::finalize(deal);
                }
                _ => {
                    if let Some(r) = deal.redelivery.as_mut() {
                        r.leg = TitleLeg::Done;
                    }
                    emit("title_leg_progress", json!({ "deal_id": U64(deal.id), "leg": LegKind::Redelivery, "status": "Done" }));
                }
            },
            Fact::TitleAtDealAddress => {
                let round = deal.redelivery.as_ref().map(|r| r.round + 1).unwrap_or(1);
                deal.redelivery = Some(Redelivery { leg: TitleLeg::Pending, requested: false, round });
                emit("title_returned", json!({ "deal_id": U64(deal.id), "round": round }));
            }
        }
    }
}

#[near]
impl Tradelock {
    /// #7. holder = beneficiary = deal-derived address on the deal's TitleEscrow. Buyer alone, or supplier + arbiter.
    pub fn confirm_title_held(&mut self, deal_id: U64, evidence: Evidence) -> bool {
        self.confirm(deal_id, Fact::TitleHeld, evidence)
    }

    /// Title leg (or redelivery) complete: holder = beneficiary = destination. Recipient alone, or the other two.
    pub fn confirm_title_transferred(&mut self, deal_id: U64, evidence: Evidence) -> bool {
        self.confirm(deal_id, Fact::TitleTransferred, evidence)
    }

    /// #20. After Settled/Refunded the title is back at the deal address (rejected, or an unconfirmed hand-over).
    pub fn confirm_title_at_deal_address(&mut self, deal_id: U64, evidence: Evidence) -> bool {
        self.confirm(deal_id, Fact::TitleAtDealAddress, evidence)
    }

    /// #21. Entitled party (buyer after Settled, supplier after Refunded) asks to resend the title to the
    /// same stored destination. No address argument (D-002).
    pub fn redeliver_title(&mut self, deal_id: U64) {
        let mut deal = self.load(deal_id.0);
        let entitled = match deal.state {
            DealState::Settled => Party::Buyer,
            DealState::Refunded => Party::Supplier,
            _ => fail("InvalidState", format!("expected [Settled, Refunded], actual {:?}", deal.state)),
        };
        Self::require_caller(&deal, entitled);
        let r = deal.redelivery.as_mut().unwrap_or_else(|| fail("InvalidState", "title not confirmed back at the deal address"));
        if r.leg == TitleLeg::Done {
            fail("InvalidState", "title not confirmed back at the deal address");
        }
        if r.requested {
            return; // idempotent
        }
        r.requested = true;
        let round = r.round;
        emit("redelivery_requested", json!({ "deal_id": deal_id, "round": round }));
        self.save(deal);
    }
}
