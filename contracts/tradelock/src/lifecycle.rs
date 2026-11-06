//! Deal lifecycle: STATE_MACHINE.md §5 transitions 1–17 (cash/title/confirmation details live in
//! cash.rs, title.rs, confirm.rs).

use crate::*;
use near_sdk::Promise;
use tradelock_evm::tradetrust::{parse_u256_dec, predict_title_escrow};

/// Gas a method must carry when it may start a cash transfer in the same call.
pub(crate) const CASH_START_GAS: Gas = Gas::from_tgas(50 + 10 + 15);

impl Tradelock {
    /// Enter Settling: cash → supplier, title → buyer (eBL) — STATE_MACHINE #8, #10, #11, #14.
    pub(crate) fn start_settlement(&mut self, deal: &mut Deal, event: &str) {
        deal.cash = CashLeg::Pending;
        deal.title = if deal.ebl().is_some() { TitleLeg::Pending } else { TitleLeg::NotApplicable };
        deal.pending_fact = None;
        deal.pending_confirmers.clear();
        Self::transition(deal, DealState::Settling, event);
        if let Some(p) = self.start_cash(deal) {
            p.detach();
        }
    }

    /// Enter Refunding: cash → buyer, title → supplier if it was held — #9, #15, #16, #17.
    pub(crate) fn start_refund(&mut self, deal: &mut Deal, title_held: bool, event: &str) {
        deal.cash = CashLeg::Pending;
        deal.title = if deal.ebl().is_some() && title_held { TitleLeg::Pending } else { TitleLeg::NotApplicable };
        deal.pending_fact = None;
        deal.pending_confirmers.clear();
        Self::transition(deal, DealState::Refunding, event);
        if let Some(p) = self.start_cash(deal) {
            p.detach();
        }
    }

    fn acceptance_deadline(&self, deal: &Deal) -> u64 {
        deal.created_at.saturating_add(self.config.acceptance_window_ns.0)
    }

    fn validate_terms(&self, buyer: &AccountId, terms: &DealTerms) -> (Mode, [u8; 32]) {
        let now = env::block_timestamp();
        if buyer == &terms.supplier || buyer == &terms.arbiter || terms.supplier == terms.arbiter {
            fail("InvalidTerms", "buyer, supplier and arbiter must be distinct accounts");
        }
        if terms.amount.0 == 0 {
            fail("InvalidTerms", "amount must be > 0");
        }
        if !self.config.allowed_tokens.contains(&terms.token_id) {
            fail("TokenNotAllowed", &terms.token_id);
        }
        let order_hash: [u8; 32] = hex::decode(&terms.order_hash)
            .ok()
            .and_then(|v| v.try_into().ok())
            .unwrap_or_else(|| fail("InvalidTerms", "order_hash must be 32 bytes hex"));
        if let PayoutTarget::Withdraw { .. } = terms.payout {
            if !terms.token_id.starts_with("nep141:") {
                fail("InvalidTerms", "Withdraw payout requires a nep141 token");
            }
        }
        let mode = match &terms.mode {
            TermsMode::EscrowOnly { deliver_by } => {
                if deliver_by.0 <= now {
                    fail("InvalidTerms", "deliver_by must be in the future");
                }
                Mode::EscrowOnly { deliver_by: deliver_by.0 }
            }
            TermsMode::Ebl { chain_id, registry, token_id, buyer_evm, supplier_evm, ship_by, doc_acceptance_window_ns } => {
                let registry_addr = parse_evm("registry", registry);
                let reg = self
                    .config
                    .title_registries
                    .iter()
                    .find(|r| r.chain_id == *chain_id && parse_evm("registry", &r.registry) == registry_addr)
                    .unwrap_or_else(|| fail("InvalidTerms", format!("registry {registry} not allowed on chain {chain_id}")));
                let factory_addr = parse_evm("factory", &reg.factory);
                let tf = self
                    .config
                    .title_factories
                    .iter()
                    .find(|f| f.chain_id == *chain_id && parse_evm("factory", &f.factory) == factory_addr)
                    .unwrap_or_else(|| fail("InvalidTerms", "registry factory has no implementation entry"));
                let implementation = parse_evm("implementation", &tf.implementation);
                let registry = registry_addr;
                let token = parse_u256_dec(token_id).unwrap_or_else(|e| fail("InvalidTerms", e));
                let buyer_evm = parse_evm("buyer_evm", buyer_evm);
                let supplier_evm = parse_evm("supplier_evm", supplier_evm);
                if buyer_evm == supplier_evm {
                    fail("InvalidTerms", "buyer_evm and supplier_evm must differ");
                }
                if ship_by.0 <= now {
                    fail("InvalidTerms", "ship_by must be in the future");
                }
                let w = doc_acceptance_window_ns.0;
                if w < self.config.min_doc_window_ns.0 || w > self.config.max_doc_window_ns.0 {
                    fail("InvalidTerms", "doc_acceptance_window_ns outside allowed bounds");
                }
                let title_escrow = predict_title_escrow(&factory_addr, &implementation, &registry, &token, keccak);
                Mode::Ebl(EblTerms {
                    chain_id: *chain_id,
                    factory: factory_addr,
                    registry,
                    token_id: token,
                    token_id_dec: token_id.clone(),
                    title_escrow,
                    buyer_evm,
                    supplier_evm,
                    ship_by: ship_by.0,
                    doc_acceptance_window_ns: w,
                    derived_address: None,
                    accept_by: None,
                })
            }
        };
        (mode, order_hash)
    }

    fn index_account(&mut self, account: &AccountId, id: DealId) {
        let mut ids = self.deals_by_account.get(account).cloned().unwrap_or_default();
        ids.push(id);
        self.deals_by_account.insert(account.clone(), ids);
    }
}

#[near]
impl Tradelock {
    /// #1. Buyer proposes terms. Attach storage deposit; excess is refunded. eBL deals also fetch their
    /// derived EVM address from the MPC contract (D-013).
    #[payable]
    pub fn create_deal(&mut self, terms: DealTerms) -> U64 {
        if self.config.paused {
            fail("Paused", "new deals are paused");
        }
        let buyer = env::predecessor_account_id();
        let (mode, order_hash) = self.validate_terms(&buyer, &terms);
        let is_ebl = matches!(mode, Mode::Ebl(_));
        if is_ebl {
            Self::require_gas(DERIVED_KEY_VIEW_GAS.saturating_add(DERIVED_KEY_CALLBACK_GAS).saturating_add(OWN_OVERHEAD));
        }

        let id = self.next_deal_id;
        self.next_deal_id += 1;
        let before = env::storage_usage();
        let deal = Deal {
            id,
            buyer: buyer.clone(),
            supplier: terms.supplier.clone(),
            arbiter: terms.arbiter.clone(),
            token_id: terms.token_id.clone(),
            amount: terms.amount.0,
            order_hash,
            payout: terms.payout.clone(),
            mode,
            state: DealState::Created,
            accepted: false,
            created_at: env::block_timestamp(),
            cash: CashLeg::Pending,
            title: TitleLeg::NotApplicable,
            disputed: false,
            disputed_with_title: false,
            votes: Votes::default(),
            pending_fact: None,
            pending_confirmers: vec![],
            confirmations: vec![],
            redelivery: None,
        };
        self.save(deal);
        self.index_account(&buyer, id);
        self.index_account(&terms.supplier, id);
        self.index_account(&terms.arbiter, id);
        let used = env::storage_usage().saturating_sub(before) + DEAL_STORAGE_RESERVE_BYTES;
        let cost = env::storage_byte_cost().saturating_mul(used as u128);
        let attached = env::attached_deposit();
        if attached < cost {
            fail("InsufficientDeposit", format!("attach at least {} yoctoNEAR for storage", cost.as_yoctonear()));
        }
        let excess = attached.saturating_sub(cost);
        if !excess.is_zero() {
            Promise::new(buyer.clone()).transfer(excess).detach();
        }

        emit("deal_created", json!({ "deal_id": U64(id), "buyer": buyer, "supplier": terms.supplier, "arbiter": terms.arbiter, "mode": if is_ebl { "ebl" } else { "escrow_only" } }));
        if is_ebl {
            self.fetch_derived_address(id).detach();
        }
        U64(id)
    }

    /// #2. Supplier accepts. eBL requires the derived address (it is where the eBL must go).
    pub fn accept_deal(&mut self, deal_id: U64) {
        let mut deal = self.load(deal_id.0);
        Self::require_caller(&deal, Party::Supplier);
        Self::require_state(&deal, &[DealState::Created]);
        if deal.accepted {
            return; // idempotent
        }
        if env::block_timestamp() >= self.acceptance_deadline(&deal) {
            fail("DeadlinePassed", "acceptance window closed");
        }
        if let Some(t) = deal.ebl() {
            if t.derived_address.is_none() {
                fail("DerivedAddressMissing", "call refresh_derived_address first");
            }
        }
        deal.accepted = true;
        emit("deal_accepted", json!({ "deal_id": deal_id }));
        self.save(deal);
    }

    /// #3.
    pub fn decline_deal(&mut self, deal_id: U64) {
        let mut deal = self.load(deal_id.0);
        Self::require_caller(&deal, Party::Supplier);
        Self::require_state(&deal, &[DealState::Created]);
        Self::transition(&mut deal, DealState::Cancelled, "deal_cancelled");
        self.save(deal);
    }

    /// #4.
    pub fn withdraw_deal(&mut self, deal_id: U64) {
        let mut deal = self.load(deal_id.0);
        Self::require_caller(&deal, Party::Buyer);
        Self::require_state(&deal, &[DealState::Created]);
        Self::transition(&mut deal, DealState::Cancelled, "deal_cancelled");
        self.save(deal);
    }

    /// #5 (anyone, Created), #16 (buyer, eBL Funded past ship_by), #17 (buyer, escrow-only Funded past deliver_by).
    pub fn claim_timeout(&mut self, deal_id: U64) {
        let mut deal = self.load(deal_id.0);
        let now = env::block_timestamp();
        match deal.state {
            DealState::Created => {
                if now < self.acceptance_deadline(&deal) {
                    fail("DeadlineNotReached", "acceptance window still open");
                }
                Self::transition(&mut deal, DealState::Cancelled, "deal_cancelled");
            }
            DealState::Funded => {
                Self::require_caller(&deal, Party::Buyer);
                let deadline = match &deal.mode {
                    Mode::Ebl(t) => t.ship_by,
                    Mode::EscrowOnly { deliver_by } => *deliver_by,
                };
                if now < deadline {
                    fail("DeadlineNotReached", "deadline not reached");
                }
                Self::require_gas(CASH_START_GAS);
                self.start_refund(&mut deal, false, "refund_started");
            }
            _ => fail("InvalidState", format!("expected [Created, Funded], actual {:?}", deal.state)),
        }
        self.save(deal);
    }

    /// #8 (D-020). Buyer pays against documents.
    pub fn accept_documents(&mut self, deal_id: U64) {
        let mut deal = self.load(deal_id.0);
        Self::require_caller(&deal, Party::Buyer);
        Self::require_state(&deal, &[DealState::TitleHeld]);
        let accept_by = deal.ebl().and_then(|t| t.accept_by).unwrap_or_else(|| fail("InvalidState", "no accept_by"));
        if env::block_timestamp() >= accept_by {
            fail("DeadlinePassed", "document acceptance window closed; use release");
        }
        Self::require_gas(CASH_START_GAS);
        emit("documents_accepted", json!({ "deal_id": deal_id }));
        self.start_settlement(&mut deal, "settlement_started");
        self.save(deal);
    }

    /// #9 (D-020). Buyer refuses the documents: cash back to buyer, title back to supplier.
    pub fn refuse_documents(&mut self, deal_id: U64, reason_hash: Option<String>) {
        let mut deal = self.load(deal_id.0);
        Self::require_caller(&deal, Party::Buyer);
        Self::require_state(&deal, &[DealState::TitleHeld]);
        let accept_by = deal.ebl().and_then(|t| t.accept_by).unwrap_or_else(|| fail("InvalidState", "no accept_by"));
        if env::block_timestamp() >= accept_by {
            fail("DeadlinePassed", "document acceptance window closed");
        }
        Self::require_gas(CASH_START_GAS);
        emit("documents_refused", json!({ "deal_id": deal_id, "reason_hash": reason_hash }));
        self.start_refund(&mut deal, true, "refund_started");
        self.save(deal);
    }

    /// #10 (D-020). Window lapsed with no accept/refuse/dispute: anyone releases.
    pub fn release(&mut self, deal_id: U64) {
        let mut deal = self.load(deal_id.0);
        Self::require_state(&deal, &[DealState::TitleHeld]);
        let accept_by = deal.ebl().and_then(|t| t.accept_by).unwrap_or_else(|| fail("InvalidState", "no accept_by"));
        if env::block_timestamp() < accept_by {
            fail("DeadlineNotReached", "document acceptance window still open");
        }
        Self::require_gas(CASH_START_GAS);
        emit("released_on_lapse", json!({ "deal_id": deal_id, "by": env::predecessor_account_id() }));
        self.start_settlement(&mut deal, "settlement_started");
        self.save(deal);
    }

    /// #11. Escrow-only: buyer confirms delivery.
    pub fn confirm_delivery(&mut self, deal_id: U64) {
        let mut deal = self.load(deal_id.0);
        Self::require_caller(&deal, Party::Buyer);
        Self::require_state(&deal, &[DealState::Funded]);
        let Mode::EscrowOnly { deliver_by } = deal.mode else {
            fail("InvalidState", "eBL deals settle against documents (accept_documents), not delivery");
        };
        if env::block_timestamp() >= deliver_by {
            fail("DeadlinePassed", "deliver_by passed");
        }
        Self::require_gas(CASH_START_GAS);
        emit("delivered", json!({ "deal_id": deal_id }));
        self.start_settlement(&mut deal, "settlement_started");
        self.save(deal);
    }

    /// #13. Buyer or supplier, once per deal (D-006).
    pub fn dispute(&mut self, deal_id: U64, reason_hash: Option<String>) {
        let mut deal = self.load(deal_id.0);
        let party = deal.party_of(&env::predecessor_account_id());
        if !matches!(party, Some(Party::Buyer) | Some(Party::Supplier)) {
            fail("Unauthorized", "only buyer or supplier may dispute");
        }
        Self::require_state(&deal, &[DealState::Funded, DealState::TitleHeld]);
        if deal.disputed {
            fail("AlreadyDisputed", "a deal can be disputed once");
        }
        deal.disputed = true;
        deal.disputed_with_title = deal.state == DealState::TitleHeld;
        deal.votes = Votes::default();
        deal.pending_fact = None;
        deal.pending_confirmers.clear();
        emit("deal_disputed", json!({ "deal_id": deal_id, "by": party, "reason_hash": reason_hash }));
        Self::transition(&mut deal, DealState::Disputed, "state_changed");
        self.save(deal);
    }

    /// #14/#15. Two identical votes execute immediately. Votes may change before the threshold.
    pub fn vote(&mut self, deal_id: U64, decision: Decision) {
        let mut deal = self.load(deal_id.0);
        Self::require_state(&deal, &[DealState::Disputed]);
        let party = deal.party_of(&env::predecessor_account_id()).unwrap_or_else(|| fail("Unauthorized", "not a deal party"));
        if decision == Decision::Release && deal.ebl().is_some() && !deal.disputed_with_title {
            fail("ReleaseWithoutTitle", "the deal never held the title");
        }
        let slot = match party {
            Party::Buyer => &mut deal.votes.buyer,
            Party::Supplier => &mut deal.votes.supplier,
            Party::Arbiter => &mut deal.votes.arbiter,
        };
        if *slot == Some(decision) {
            return; // idempotent
        }
        *slot = Some(decision);
        emit("vote_cast", json!({ "deal_id": deal_id, "party": party, "decision": decision }));
        let v = &deal.votes;
        let count = [v.buyer, v.supplier, v.arbiter].iter().filter(|d| **d == Some(decision)).count();
        if count >= 2 {
            Self::require_gas(CASH_START_GAS);
            match decision {
                Decision::Release => self.start_settlement(&mut deal, "settlement_started"),
                Decision::Refund => {
                    let held = deal.disputed_with_title;
                    self.start_refund(&mut deal, held, "refund_started")
                }
            }
        }
        self.save(deal);
    }
}
