//! Cash leg on the NEAR Intents Verifier (V-16): receive via `mt_on_transfer`, pay/refund via
//! `mt_transfer` / `ft_withdraw`. CashLeg::Done only in the success callback.

use crate::*;
use near_sdk::{Promise, PromiseOrValue};

/// Upper bound when reading a callback result.
const MAX_RESULT_LEN: usize = 256;

/// `msg` = `{"deal_id": 7}` or `{"deal_id": "7"}`.
fn parse_funding_msg(msg: &str) -> Option<DealId> {
    let v: serde_json::Value = serde_json::from_str(msg).ok()?;
    match v.get("deal_id")? {
        serde_json::Value::Number(n) => n.as_u64(),
        serde_json::Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

impl Tradelock {
    /// Issue the pending cash transfer for the current direction. No-op unless the leg is Pending.
    pub(crate) fn start_cash(&self, deal: &mut Deal) -> Option<Promise> {
        if deal.cash != CashLeg::Pending {
            return None;
        }
        let refund = match deal.state {
            DealState::Settling => false,
            DealState::Refunding => true,
            _ => return None,
        };
        deal.cash = CashLeg::TransferRequested;
        emit("cash_leg_progress", json!({ "deal_id": U64(deal.id), "cash_leg": deal.cash, "direction": if refund { "refund" } else { "payout" } }));
        let memo = format!("tradelock:deal:{}", deal.id);
        let amount = U128(deal.amount);
        let (method, args, withdraw) = if refund {
            ("mt_transfer", json!({ "receiver_id": deal.buyer, "token_id": deal.token_id, "amount": amount, "memo": memo }), false)
        } else {
            match &deal.payout {
                PayoutTarget::Internal { account } => {
                    ("mt_transfer", json!({ "receiver_id": account, "token_id": deal.token_id, "amount": amount, "memo": memo }), false)
                }
                PayoutTarget::Withdraw { account } => {
                    let token = deal.token_id.strip_prefix("nep141:").unwrap_or_else(|| fail("InvalidTerms", "Withdraw needs nep141"));
                    ("ft_withdraw", json!({ "token": token, "receiver_id": account, "amount": amount, "memo": memo }), true)
                }
            }
        };
        Some(
            Promise::new(self.config.verifier.clone())
                .function_call(method, args.to_string().into_bytes(), NearToken::from_yoctonear(1), VERIFIER_CALL_GAS)
                .then(Self::ext(env::current_account_id()).with_static_gas(CASH_CALLBACK_GAS).with_unused_gas_weight(0).on_cash_transfer(U64(deal.id), withdraw)),
        )
    }

    /// Settling/Refunding → terminal when both legs are complete (#12, #18).
    pub(crate) fn finalize(deal: &mut Deal) {
        if deal.cash != CashLeg::Done || !deal.title.is_complete() {
            return;
        }
        match deal.state {
            DealState::Settling => Self::transition(deal, DealState::Settled, "deal_settled"),
            DealState::Refunding => Self::transition(deal, DealState::Refunded, "deal_refunded"),
            _ => {}
        }
    }
}

#[near]
impl Tradelock {
    /// #6. NEP-245 receiver, called by the Verifier after the buyer's `mt_transfer_call` with
    /// `msg = {"deal_id": N}`. Never panics: any mismatch returns a full refund, state unchanged.
    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        let refund_all = amounts.clone();
        let reject = |reason: &str| {
            emit("funding_rejected", json!({ "sender_id": sender_id, "reason": reason }));
            PromiseOrValue::Value(refund_all.clone())
        };
        if env::predecessor_account_id() != self.config.verifier {
            return reject("caller is not the configured Verifier");
        }
        if token_ids.len() != 1 || amounts.len() != 1 {
            return reject("exactly one token per funding");
        }
        let Some(deal_id) = parse_funding_msg(&msg) else {
            return reject("msg must be {\"deal_id\": N}");
        };
        let Some(mut deal) = self.deals.get(&deal_id).cloned() else {
            return reject("deal not found");
        };
        if deal.state != DealState::Created || !deal.accepted {
            return reject("deal is not awaiting funding");
        }
        if sender_id != deal.buyer || previous_owner_ids.iter().any(|o| o != &deal.buyer) {
            return reject("funds must come from the buyer's own balance");
        }
        if token_ids[0] != deal.token_id {
            return reject("TokenMismatch");
        }
        if amounts[0].0 != deal.amount {
            return reject("AmountMismatch");
        }
        if env::block_timestamp() >= deal.created_at.saturating_add(self.config.acceptance_window_ns.0) {
            return reject("acceptance window closed");
        }
        Self::transition(&mut deal, DealState::Funded, "deal_funded");
        self.save(deal);
        PromiseOrValue::Value(vec![U128(0)])
    }

    /// Callback for mt_transfer (void on success) / ft_withdraw (returns the amount delivered;
    /// 0 + internal refund on failure). Failure → Pending; `resume` retries.
    #[private]
    pub fn on_cash_transfer(&mut self, deal_id: U64, withdraw: bool) -> bool {
        let mut deal = self.load(deal_id.0);
        if deal.cash != CashLeg::TransferRequested {
            return false;
        }
        let ok = match env::promise_result_checked(0, MAX_RESULT_LEN) {
            Err(_) => false,
            Ok(bytes) if withdraw => serde_json::from_slice::<U128>(&bytes).map(|v| v.0 == deal.amount).unwrap_or(false),
            Ok(_) => true,
        };
        deal.cash = if ok { CashLeg::Done } else { CashLeg::Pending };
        emit("cash_leg_progress", json!({ "deal_id": deal_id, "cash_leg": deal.cash, "ok": ok }));
        if ok {
            Self::finalize(&mut deal);
        }
        self.save(deal);
        ok
    }

    /// #19. Anyone re-issues a failed cash transfer.
    pub fn resume(&mut self, deal_id: U64) {
        let mut deal = self.load(deal_id.0);
        Self::require_state(&deal, &[DealState::Settling, DealState::Refunding]);
        if deal.cash != CashLeg::Pending {
            return; // in flight or done: no-op
        }
        Self::require_gas(crate::lifecycle::CASH_START_GAS);
        if let Some(p) = self.start_cash(&mut deal) {
            p.detach();
        }
        self.save(deal);
    }
}
