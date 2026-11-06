//! Unit tests for the STATE_MACHINE.md §9 matrix. Cross-contract calls do not execute in unit tests;
//! callbacks are invoked directly with mocked promise results. The "MPC" here is a local test key
//! (`mock_mpc_*`, tests only — S-05). Sandbox E2E against the real Verifier is in tests/sandbox.rs.

use super::*;
use k256::ecdsa::SigningKey;
use near_parameters::RuntimeFeesConfig;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, PromiseError, PromiseResult};

const SEC: u64 = 1_000_000_000;
const T0: u64 = 1_800_000_000 * SEC;
const AMOUNT: u128 = 1_000_000;
const TOKEN: &str = "nep141:usdc.test.near";
// Real T1 values (DEPLOYMENTS.md) so the computed TitleEscrow can be checked against Sepolia.
const FACTORY: &str = "0xfcafea839e576967b96ad1FBFB52b5CA26cd1D25";
const IMPLEMENTATION: &str = "0x3781bd0bbd15bf5e45c7296115821933d47362be";
const REGISTRY: &str = "0x4e95A0b956d5CADeD0864Df2D26a508257BeC811";
const EBL_TOKEN: &str = "99341760963449555253449397465407527918038632140097791491231289799516335410376";
const T1_ESCROW: &str = "0x9e549e4467e013e71f87402cbdc5c6e438e7f193";
const BUYER_EVM: &str = "0x6a7d2cf926879f23692ab6058258d1eb7c3e46ed";
const SUPPLIER_EVM: &str = "0xefbc93fc249040e533d8191def10dc58d4108717";
const WINDOW: u64 = 3_600 * SEC;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn me() -> AccountId {
    acc("tradelock.test.near")
}
fn buyer() -> AccountId {
    acc("buyer.test.near")
}
fn supplier() -> AccountId {
    acc("supplier.test.near")
}
fn arbiter() -> AccountId {
    acc("arbiter.test.near")
}
fn stranger() -> AccountId {
    acc("stranger.test.near")
}
fn verifier() -> AccountId {
    acc("intents.test.near")
}

struct Env {
    now: u64,
}

impl Env {
    fn set(&self, who: AccountId, deposit: u128, gas_tgas: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(me())
            .predecessor_account_id(who)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .prepaid_gas(Gas::from_tgas(gas_tgas))
            .block_timestamp(self.now)
            .account_balance(NearToken::from_near(100));
        testing_env!(b.build());
    }
    fn call(&self, who: AccountId) {
        self.set(who, 0, 300);
    }
    fn callback(&self, result: PromiseResult) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(me()).predecessor_account_id(me()).prepaid_gas(Gas::from_tgas(300)).block_timestamp(self.now);
        testing_env!(b.build(), test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![result]);
    }
}

fn config() -> Config {
    Config {
        owner: acc("owner.test.near"),
        verifier: verifier(),
        mpc_contract: acc("mpc.test.near"),
        allowed_tokens: vec![TOKEN.into()],
        title_factories: vec![TitleFactory { chain_id: 11155111, factory: FACTORY.into(), implementation: IMPLEMENTATION.into() }],
        title_registries: vec![TitleRegistry { chain_id: 11155111, registry: REGISTRY.into(), factory: FACTORY.into() }],
        mpc_sign_deposit: U128(1),
        mpc_sign_gas_tgas: 30,
        callback_gas_tgas: 10,
        max_fee_per_gas: U128(200_000_000_000),
        max_priority_fee_per_gas: U128(20_000_000_000),
        max_gas_limit: U64(500_000),
        acceptance_window_ns: U64(86_400 * SEC),
        min_doc_window_ns: U64(60 * SEC),
        max_doc_window_ns: U64(30 * 86_400 * SEC),
        paused: false,
    }
}

fn ebl_terms() -> DealTerms {
    DealTerms {
        supplier: supplier(),
        arbiter: arbiter(),
        token_id: TOKEN.into(),
        amount: U128(AMOUNT),
        order_hash: "11".repeat(32),
        payout: PayoutTarget::Internal { account: supplier() },
        mode: TermsMode::Ebl {
            chain_id: 11155111,
            registry: REGISTRY.into(),
            token_id: EBL_TOKEN.into(),
            buyer_evm: BUYER_EVM.into(),
            supplier_evm: SUPPLIER_EVM.into(),
            ship_by: U64(T0 + 7 * 86_400 * SEC),
            doc_acceptance_window_ns: U64(WINDOW),
        },
    }
}

fn escrow_terms() -> DealTerms {
    DealTerms { mode: TermsMode::EscrowOnly { deliver_by: U64(T0 + 7 * 86_400 * SEC) }, ..ebl_terms() }
}

fn mpc_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32].into()).unwrap()
}

/// "secp256k1:<base58 x‖y>" as v1.signer.derived_public_key returns it.
fn naj_of(k: &SigningKey) -> String {
    let p = k.verifying_key().to_encoded_point(false);
    format!("secp256k1:{}", bs58::encode(&p.as_bytes()[1..]).into_string())
}

fn addr_of(k: &SigningKey) -> Address {
    let p = k.verifying_key().to_encoded_point(false);
    env::keccak256_array(&p.as_bytes()[1..])[12..].try_into().unwrap()
}

/// v1.signer-shaped response from a local key (test-only stand-in for the MPC).
fn mock_mpc_response(k: &SigningKey, payload: &[u8; 32]) -> serde_json::Value {
    let (sig, recid) = k.sign_prehash_recoverable(payload).unwrap();
    let b = sig.to_bytes();
    let mut big_r = vec![2 + recid.is_y_odd() as u8];
    big_r.extend_from_slice(&b[..32]);
    serde_json::json!({ "scheme": "Secp256k1", "big_r": { "affine_point": hex::encode(big_r) }, "s": { "scalar": hex::encode(&b[32..]) }, "recovery_id": recid.to_byte() })
}

fn ev_at(addr: &str, block: u64) -> Evidence {
    Evidence { holder: addr.into(), beneficiary: addr.into(), block_number: U64(block), tx_hash: None }
}
/// holder = beneficiary = the deal-derived address (title held / back at the deal address).
fn evd(block: u64) -> Evidence {
    ev_at(&to_hex(&addr_of(&mpc_key())), block)
}
fn evb(block: u64) -> Evidence {
    ev_at(BUYER_EVM, block)
}
fn evs(block: u64) -> Evidence {
    ev_at(SUPPLIER_EVM, block)
}

fn new_contract(e: &Env) -> Tradelock {
    e.call(acc("deployer.test.near"));
    Tradelock::new(config())
}

fn create(c: &mut Tradelock, e: &Env, terms: DealTerms) -> U64 {
    e.set(buyer(), NearToken::from_near(1).as_yoctonear(), 300);
    c.create_deal(terms)
}

/// Created (eBL) → derived address stored → accepted → Funded.
fn funded_ebl(c: &mut Tradelock, e: &Env) -> U64 {
    let id = create(c, e, ebl_terms());
    e.callback(PromiseResult::Successful(vec![]));
    c.on_derived_public_key(id, Ok(naj_of(&mpc_key())));
    e.call(supplier());
    c.accept_deal(id);
    fund(c, e, id);
    id
}

fn funded_escrow(c: &mut Tradelock, e: &Env) -> U64 {
    let id = create(c, e, escrow_terms());
    e.call(supplier());
    c.accept_deal(id);
    fund(c, e, id);
    id
}

fn fund(c: &mut Tradelock, e: &Env, id: U64) {
    e.call(verifier());
    let r = c.mt_on_transfer(buyer(), vec![buyer()], vec![TOKEN.into()], vec![U128(AMOUNT)], format!("{{\"deal_id\":{}}}", id.0));
    assert_eq!(refund_of(r), vec![U128(0)]);
    assert_eq!(c.load(id.0).state, DealState::Funded);
}

fn refund_of(r: near_sdk::PromiseOrValue<Vec<U128>>) -> Vec<U128> {
    match r {
        near_sdk::PromiseOrValue::Value(v) => v,
        _ => panic!("expected value"),
    }
}

fn title_held(c: &mut Tradelock, e: &Env) -> U64 {
    let id = funded_ebl(c, e);
    e.call(buyer());
    assert!(c.confirm_title_held(id, evd(100)));
    id
}

fn cash_ok(c: &mut Tradelock, e: &Env, id: U64) {
    e.callback(PromiseResult::Successful(vec![]));
    assert!(c.on_cash_transfer(id, false));
}

fn state(c: &Tradelock, id: U64) -> DealState {
    c.load(id.0).state
}

fn sign_ok(c: &mut Tradelock, e: &Env, id: U64, kind: LegKind, nonce: u64) -> StoredTx {
    e.set(stranger(), 5, 300);
    let _ = c.request_title_signature(id, U64(nonce), U128(30_000_000_000), U128(1_500_000_000), U64(120_000));
    let d = c.load(id.0);
    let leg = match kind {
        LegKind::Main => d.title.clone(),
        LegKind::Redelivery => d.redelivery.clone().unwrap().leg,
    };
    let TitleLeg::SignatureRequested { tx } = leg else { panic!("expected SignatureRequested, got {leg:?}") };
    e.callback(PromiseResult::Successful(vec![]));
    assert!(c.on_signature(id, kind, U64(nonce), Ok(mock_mpc_response(&mpc_key(), &tx.payload))));
    tx
}

macro_rules! fails {
    ($name:ident, $msg:literal, $body:expr) => {
        #[test]
        #[should_panic(expected = $msg)]
        fn $name() {
            $body
        }
    };
}

// ===================== #1 create_deal =====================

#[test]
fn create_ebl_computes_t1_title_escrow_and_requests_derived_address() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = create(&mut c, &e, ebl_terms());
    let v = c.get_deal(id).unwrap();
    assert_eq!(v.state, DealState::Created);
    let ebl = v.ebl.unwrap();
    assert_eq!(ebl.title_escrow, T1_ESCROW);
    assert_eq!(ebl.derivation_path, "tradelock/deal/0");
    assert!(ebl.derived_address.is_none());
    assert!(get_logs().iter().any(|l| l.contains("deal_created")));
    assert_eq!(c.get_deals_by_account(supplier(), None, None).len(), 1);
}

fails!(create_rejects_same_parties, "InvalidTerms", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let mut t = ebl_terms();
    t.arbiter = supplier();
    create(&mut c, &e, t);
});
fails!(create_rejects_buyer_as_supplier, "InvalidTerms", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let mut t = ebl_terms();
    t.supplier = buyer();
    create(&mut c, &e, t);
});
fails!(create_rejects_unlisted_token, "TokenNotAllowed", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let mut t = ebl_terms();
    t.token_id = "nep141:evil.near".into();
    create(&mut c, &e, t);
});
fails!(create_rejects_zero_amount, "InvalidTerms: amount", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let mut t = ebl_terms();
    t.amount = U128(0);
    create(&mut c, &e, t);
});
fails!(create_rejects_bad_order_hash, "InvalidTerms: order_hash", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let mut t = ebl_terms();
    t.order_hash = "abc".into();
    create(&mut c, &e, t);
});
fails!(create_rejects_unlisted_registry, "registry 0x1111111111111111111111111111111111111111 not allowed", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let mut t = ebl_terms();
    if let TermsMode::Ebl { registry, .. } = &mut t.mode {
        *registry = "0x1111111111111111111111111111111111111111".into();
    }
    create(&mut c, &e, t);
});
fails!(title_config_rejects_registry_without_factory_entry, "no implementation entry", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    e.call(acc("owner.test.near"));
    c.set_title_config(vec![], vec![TitleRegistry { chain_id: 11155111, registry: REGISTRY.into(), factory: FACTORY.into() }]);
});
fails!(title_held_wrong_holder_rejected, "EvidenceMismatch", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_ebl(&mut c, &e);
    e.call(buyer());
    c.confirm_title_held(id, ev_at(SUPPLIER_EVM, 1)); // title still with the supplier
});
fails!(title_held_split_roles_rejected, "EvidenceMismatch", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_ebl(&mut c, &e);
    let mut ev = evd(1);
    ev.beneficiary = SUPPLIER_EVM.into(); // holder moved, beneficiary did not
    e.call(buyer());
    c.confirm_title_held(id, ev);
});
fails!(title_transferred_to_wrong_address_rejected, "EvidenceMismatch", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.refuse_documents(id, None);
    e.call(supplier());
    c.confirm_title_transferred(id, evb(1)); // refund direction expects supplier_evm
});
fails!(create_rejects_unlisted_chain, "not allowed on chain", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let mut t = ebl_terms();
    if let TermsMode::Ebl { chain_id, .. } = &mut t.mode {
        *chain_id = 1;
    }
    create(&mut c, &e, t);
});
fails!(create_rejects_past_ship_by, "ship_by must be in the future", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let mut t = ebl_terms();
    if let TermsMode::Ebl { ship_by, .. } = &mut t.mode {
        *ship_by = U64(T0);
    }
    create(&mut c, &e, t);
});
fails!(create_rejects_window_out_of_bounds, "doc_acceptance_window_ns", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let mut t = ebl_terms();
    if let TermsMode::Ebl { doc_acceptance_window_ns, .. } = &mut t.mode {
        *doc_acceptance_window_ns = U64(SEC);
    }
    create(&mut c, &e, t);
});
fails!(create_rejects_same_evm_addresses, "must differ", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let mut t = ebl_terms();
    if let TermsMode::Ebl { supplier_evm, .. } = &mut t.mode {
        *supplier_evm = BUYER_EVM.into();
    }
    create(&mut c, &e, t);
});
fails!(create_rejects_past_deliver_by, "deliver_by must be in the future", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let t = DealTerms { mode: TermsMode::EscrowOnly { deliver_by: U64(T0 - 1) }, ..ebl_terms() };
    create(&mut c, &e, t);
});
fails!(create_requires_storage_deposit, "InsufficientDeposit", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    e.set(buyer(), 1, 300);
    c.create_deal(ebl_terms());
});
fails!(create_rejected_when_paused, "Paused", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    e.call(acc("owner.test.near"));
    c.set_paused(true);
    create(&mut c, &e, ebl_terms());
});
fails!(create_withdraw_payout_needs_nep141, "Withdraw payout requires a nep141", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    e.call(acc("owner.test.near"));
    c.set_allowed_tokens(vec!["nep245:mt.near:x".into()]);
    let t = DealTerms { token_id: "nep245:mt.near:x".into(), payout: PayoutTarget::Withdraw { account: supplier() }, ..ebl_terms() };
    create(&mut c, &e, t);
});

// ===================== derived address (D-013) =====================

#[test]
fn derived_address_callback_stores_and_refuses_change() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = create(&mut c, &e, ebl_terms());
    e.callback(PromiseResult::Successful(vec![]));
    let a = c.on_derived_public_key(id, Ok(naj_of(&mpc_key()))).unwrap();
    assert_eq!(a, to_hex(&addr_of(&mpc_key())));
    // A different key later is refused (not overwritten).
    let other = SigningKey::from_bytes(&[9u8; 32].into()).unwrap();
    assert!(c.on_derived_public_key(id, Ok(naj_of(&other))).is_none());
    assert_eq!(c.get_deal(id).unwrap().ebl.unwrap().derived_address.unwrap(), a);
}

#[test]
fn derived_address_failure_leaves_it_unset() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = create(&mut c, &e, ebl_terms());
    e.callback(PromiseResult::Failed);
    assert!(c.on_derived_public_key(id, Err(PromiseError::Failed)).is_none());
    assert!(c.get_deal(id).unwrap().ebl.unwrap().derived_address.is_none());
    e.call(stranger());
    let _ = c.refresh_derived_address(id); // allowed while missing
}

#[test]
fn derived_address_from_v1_signer_testnet_vector() {
    // Real response recorded by `pnpm gen:vectors` from v1.signer-prod.testnet (tradelock-proof vectors).
    let v: serde_json::Value = serde_json::from_str(include_str!("../../tradelock-proof/tests/vectors/derived_address.json")).unwrap();
    let e = Env { now: T0 };
    e.call(me());
    for t in v["vectors"].as_array().unwrap() {
        let got = tradelock_evm::address::evm_address_from_naj(t["derived_public_key"].as_str().unwrap(), keccak).unwrap();
        assert_eq!(to_hex(&got), t["address"].as_str().unwrap());
    }
}

// ===================== #2–#5 =====================

#[test]
fn accept_is_supplier_only_and_idempotent() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = create(&mut c, &e, escrow_terms());
    e.call(supplier());
    c.accept_deal(id);
    c.accept_deal(id);
    assert!(c.load(id.0).accepted);
}
fails!(accept_by_buyer_rejected, "Unauthorized", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = create(&mut c, &e, escrow_terms());
    e.call(buyer());
    c.accept_deal(id);
});
fails!(accept_ebl_needs_derived_address, "DerivedAddressMissing", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = create(&mut c, &e, ebl_terms());
    e.call(supplier());
    c.accept_deal(id);
});
fails!(accept_after_window_rejected, "DeadlinePassed", {
    let mut e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = create(&mut c, &e, escrow_terms());
    e.now = T0 + 86_400 * SEC;
    e.call(supplier());
    c.accept_deal(id);
});

#[test]
fn decline_withdraw_and_acceptance_timeout_cancel() {
    let mut e = Env { now: T0 };
    let mut c = new_contract(&e);
    let a = create(&mut c, &e, escrow_terms());
    let b = create(&mut c, &e, escrow_terms());
    let d = create(&mut c, &e, escrow_terms());
    e.call(supplier());
    c.decline_deal(a);
    e.call(buyer());
    c.withdraw_deal(b);
    e.now = T0 + 86_400 * SEC;
    e.call(stranger());
    c.claim_timeout(d);
    for id in [a, b, d] {
        assert_eq!(state(&c, id), DealState::Cancelled);
    }
}
fails!(acceptance_timeout_too_early, "DeadlineNotReached", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = create(&mut c, &e, escrow_terms());
    e.call(stranger());
    c.claim_timeout(id);
});
fails!(withdraw_after_funding_rejected, "InvalidState", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_escrow(&mut c, &e);
    e.call(buyer());
    c.withdraw_deal(id);
});

// ===================== #6 funding =====================

#[test]
fn funding_mismatches_are_refunded_in_full() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = create(&mut c, &e, escrow_terms());
    let msg = format!("{{\"deal_id\":\"{}\"}}", id.0);
    // not accepted yet
    e.call(verifier());
    assert_eq!(refund_of(c.mt_on_transfer(buyer(), vec![buyer()], vec![TOKEN.into()], vec![U128(AMOUNT)], msg.clone())), vec![U128(AMOUNT)]);
    e.call(supplier());
    c.accept_deal(id);
    e.call(verifier());
    let cases: Vec<(AccountId, Vec<AccountId>, &str, u128, String)> = vec![
        (buyer(), vec![buyer()], "nep141:other.near", AMOUNT, msg.clone()), // TokenMismatch
        (buyer(), vec![buyer()], TOKEN, AMOUNT - 1, msg.clone()),          // AmountMismatch
        (stranger(), vec![stranger()], TOKEN, AMOUNT, msg.clone()),        // not the buyer
        (buyer(), vec![buyer()], TOKEN, AMOUNT, "{}".into()),               // bad msg
        (buyer(), vec![buyer()], TOKEN, AMOUNT, "{\"deal_id\":99}".into()), // unknown deal
    ];
    for (sender, owners, token, amount, m) in cases {
        let r = refund_of(c.mt_on_transfer(sender, owners, vec![token.into()], vec![U128(amount)], m));
        assert_eq!(r, vec![U128(amount)]);
        assert_eq!(state(&c, id), DealState::Created);
    }
    // wrong caller (not the Verifier)
    e.call(stranger());
    assert_eq!(refund_of(c.mt_on_transfer(buyer(), vec![buyer()], vec![TOKEN.into()], vec![U128(AMOUNT)], msg.clone())), vec![U128(AMOUNT)]);
    // success with string deal id, then a second funding is refunded
    e.call(verifier());
    assert_eq!(refund_of(c.mt_on_transfer(buyer(), vec![buyer()], vec![TOKEN.into()], vec![U128(AMOUNT)], msg.clone())), vec![U128(0)]);
    assert_eq!(state(&c, id), DealState::Funded);
    assert_eq!(refund_of(c.mt_on_transfer(buyer(), vec![buyer()], vec![TOKEN.into()], vec![U128(AMOUNT)], msg)), vec![U128(AMOUNT)]);
}

// ===================== #7 title held (D-019) =====================

#[test]
fn title_held_by_buyer_alone_starts_acceptance_window() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    let v = c.get_deal(id).unwrap();
    assert_eq!(v.state, DealState::TitleHeld);
    assert_eq!(v.ebl.unwrap().accept_by.unwrap().0, T0 + WINDOW);
    // repeated confirmation is a no-op
    e.call(buyer());
    assert!(!c.confirm_title_held(id, evd(101)));
}

#[test]
fn title_held_by_supplier_and_arbiter_together() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_ebl(&mut c, &e);
    e.call(supplier());
    assert!(!c.confirm_title_held(id, evd(100)));
    assert!(!c.confirm_title_held(id, evd(100))); // same party twice: no-op
    assert_eq!(state(&c, id), DealState::Funded);
    e.call(arbiter());
    assert!(c.confirm_title_held(id, evd(105))); // evidence need not be identical (D-021)
    assert_eq!(state(&c, id), DealState::TitleHeld);
    assert_eq!(c.get_deal(id).unwrap().confirmations.len(), 2);
}
fails!(title_held_by_stranger_rejected, "Unauthorized", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_ebl(&mut c, &e);
    e.call(stranger());
    c.confirm_title_held(id, evd(1));
});
fails!(title_held_after_ship_by_rejected, "DeadlinePassed", {
    let mut e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_ebl(&mut c, &e);
    e.now = T0 + 7 * 86_400 * SEC;
    e.call(buyer());
    c.confirm_title_held(id, evd(1));
});
fails!(title_held_needs_block_number, "block_number", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_ebl(&mut c, &e);
    e.call(buyer());
    c.confirm_title_held(id, evd(0));
});
fails!(title_held_not_for_escrow_only, "escrow-only", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_escrow(&mut c, &e);
    e.call(buyer());
    c.confirm_title_held(id, evd(1));
});

// ===================== #8–#10 documents against payment (D-020) =====================

#[test]
fn accept_documents_starts_both_legs() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.accept_documents(id);
    let d = c.load(id.0);
    assert_eq!(d.state, DealState::Settling);
    assert_eq!(d.cash, CashLeg::TransferRequested);
    assert_eq!(d.title, TitleLeg::Pending);
}
fails!(accept_documents_at_deadline_rejected, "DeadlinePassed", {
    let mut e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.now = T0 + WINDOW;
    e.call(buyer());
    c.accept_documents(id);
});
fails!(accept_documents_by_supplier_rejected, "Unauthorized", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(supplier());
    c.accept_documents(id);
});
fails!(accept_documents_needs_gas, "InsufficientGas", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.set(buyer(), 0, 20);
    c.accept_documents(id);
});

#[test]
fn refuse_documents_refunds_cash_and_returns_title() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.refuse_documents(id, Some("ab".repeat(32)));
    let d = c.load(id.0);
    assert_eq!(d.state, DealState::Refunding);
    assert_eq!(d.title, TitleLeg::Pending);
    assert_eq!(d.title_dest().unwrap(), parse_address(SUPPLIER_EVM).unwrap());
}
fails!(refuse_documents_after_window_rejected, "DeadlinePassed", {
    let mut e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.now = T0 + WINDOW + 1;
    e.call(buyer());
    c.refuse_documents(id, None);
});

#[test]
fn release_after_window_by_anyone() {
    let mut e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.now = T0 + WINDOW;
    e.call(stranger());
    c.release(id);
    assert_eq!(state(&c, id), DealState::Settling);
    assert_eq!(c.load(id.0).title_dest().unwrap(), parse_address(BUYER_EVM).unwrap());
}
fails!(release_before_window_rejected, "DeadlineNotReached", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(stranger());
    c.release(id);
});
fails!(accept_after_settling_rejected, "InvalidState", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.accept_documents(id);
    c.accept_documents(id);
});
fails!(confirm_delivery_rejected_in_ebl_mode, "settle against documents", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_ebl(&mut c, &e);
    e.call(buyer());
    c.confirm_delivery(id);
});

// ===================== #11, #17 escrow-only =====================

#[test]
fn escrow_only_full_lifecycle() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_escrow(&mut c, &e);
    e.call(buyer());
    c.confirm_delivery(id);
    assert_eq!(c.load(id.0).title, TitleLeg::NotApplicable);
    cash_ok(&mut c, &e, id);
    assert_eq!(state(&c, id), DealState::Settled);
}
fails!(confirm_delivery_twice_rejected, "InvalidState", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_escrow(&mut c, &e);
    e.call(buyer());
    c.confirm_delivery(id);
    c.confirm_delivery(id);
});
fails!(confirm_delivery_after_deadline_rejected, "DeadlinePassed", {
    let mut e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_escrow(&mut c, &e);
    e.now = T0 + 7 * 86_400 * SEC;
    e.call(buyer());
    c.confirm_delivery(id);
});

#[test]
fn escrow_only_timeout_refunds_buyer() {
    let mut e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_escrow(&mut c, &e);
    e.now = T0 + 7 * 86_400 * SEC;
    e.call(buyer());
    c.claim_timeout(id);
    assert_eq!(state(&c, id), DealState::Refunding);
    cash_ok(&mut c, &e, id);
    assert_eq!(state(&c, id), DealState::Refunded);
}

/// T4 in escrow-only mode: a supplier facing a silent buyer disputes before deliver_by.
#[test]
fn escrow_only_dispute_blocks_buyer_timeout_and_supplier_arbiter_release() {
    let mut e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_escrow(&mut c, &e);
    e.call(supplier());
    c.dispute(id, None);
    e.now = T0 + 8 * 86_400 * SEC;
    e.call(buyer());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.claim_timeout(id)));
    assert!(r.is_err());
    e.call(supplier());
    c.vote(id, Decision::Release);
    e.call(arbiter());
    c.vote(id, Decision::Release);
    assert_eq!(state(&c, id), DealState::Settling);
}

// ===================== #16 ship_by =====================

#[test]
fn ship_by_timeout_refunds_without_title() {
    let mut e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_ebl(&mut c, &e);
    e.now = T0 + 7 * 86_400 * SEC;
    e.call(buyer());
    c.claim_timeout(id);
    let d = c.load(id.0);
    assert_eq!(d.state, DealState::Refunding);
    assert_eq!(d.title, TitleLeg::NotApplicable);
}
fails!(ship_by_timeout_too_early, "DeadlineNotReached", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_ebl(&mut c, &e);
    e.call(buyer());
    c.claim_timeout(id);
});
fails!(ship_by_timeout_by_supplier_rejected, "Unauthorized", {
    let mut e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_ebl(&mut c, &e);
    e.now = T0 + 7 * 86_400 * SEC;
    e.call(supplier());
    c.claim_timeout(id);
});
fails!(no_timeout_once_title_held, "InvalidState", {
    let mut e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.now = T0 + 30 * 86_400 * SEC;
    e.call(buyer());
    c.claim_timeout(id);
});

// ===================== #13–#15 disputes and votes =====================

#[test]
fn release_votes_each_pair_settle() {
    for (a, b) in [(buyer(), supplier()), (buyer(), arbiter()), (supplier(), arbiter())] {
        let e = Env { now: T0 };
        let mut c = new_contract(&e);
        let id = title_held(&mut c, &e);
        e.call(supplier());
        c.dispute(id, None);
        e.call(a.clone());
        c.vote(id, Decision::Release);
        assert_eq!(state(&c, id), DealState::Disputed);
        e.call(b.clone());
        c.vote(id, Decision::Release);
        assert_eq!(state(&c, id), DealState::Settling, "{a} + {b}");
    }
}

#[test]
fn refund_votes_each_pair_refund_with_title_when_held() {
    for (a, b) in [(buyer(), supplier()), (buyer(), arbiter()), (supplier(), arbiter())] {
        let e = Env { now: T0 };
        let mut c = new_contract(&e);
        let id = title_held(&mut c, &e);
        e.call(buyer());
        c.dispute(id, None);
        e.call(a.clone());
        c.vote(id, Decision::Refund);
        e.call(b.clone());
        c.vote(id, Decision::Refund);
        let d = c.load(id.0);
        assert_eq!(d.state, DealState::Refunding);
        assert_eq!(d.title, TitleLeg::Pending);
    }
}

#[test]
fn vote_change_before_threshold_and_same_vote_noop() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.dispute(id, None);
    c.vote(id, Decision::Refund);
    c.vote(id, Decision::Refund); // no-op
    e.call(supplier());
    c.vote(id, Decision::Release);
    e.call(buyer());
    c.vote(id, Decision::Release); // change → 2 × Release
    assert_eq!(state(&c, id), DealState::Settling);
}

#[test]
fn refund_vote_without_title_has_no_title_leg() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_ebl(&mut c, &e);
    e.call(buyer());
    c.dispute(id, None);
    c.vote(id, Decision::Refund);
    e.call(arbiter());
    c.vote(id, Decision::Refund);
    assert_eq!(c.load(id.0).title, TitleLeg::NotApplicable);
}
fails!(release_vote_without_title_rejected, "ReleaseWithoutTitle", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_ebl(&mut c, &e);
    e.call(supplier());
    c.dispute(id, None);
    c.vote(id, Decision::Release);
});
fails!(dispute_twice_rejected, "InvalidState", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.dispute(id, None);
    c.dispute(id, None);
});
fails!(arbiter_cannot_dispute, "Unauthorized", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(arbiter());
    c.dispute(id, None);
});
fails!(dispute_blocks_release, "InvalidState", {
    let mut e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.dispute(id, None);
    e.now = T0 + WINDOW + 1;
    e.call(stranger());
    c.release(id);
});
fails!(dispute_after_settlement_started_rejected, "InvalidState", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.accept_documents(id);
    e.call(supplier());
    c.dispute(id, None);
});
fails!(stranger_cannot_vote, "Unauthorized", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.dispute(id, None);
    e.call(stranger());
    c.vote(id, Decision::Refund);
});

// ===================== cash leg =====================

#[test]
fn cash_failure_then_resume() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_escrow(&mut c, &e);
    e.call(buyer());
    c.confirm_delivery(id);
    e.callback(PromiseResult::Failed);
    assert!(!c.on_cash_transfer(id, false));
    assert_eq!(c.load(id.0).cash, CashLeg::Pending);
    e.call(stranger());
    c.resume(id);
    assert_eq!(c.load(id.0).cash, CashLeg::TransferRequested);
    c.resume(id); // in flight: no-op
    cash_ok(&mut c, &e, id);
    assert_eq!(state(&c, id), DealState::Settled);
    e.call(stranger());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.resume(id)));
    assert!(r.is_err(), "resume after Settled is rejected");
}

#[test]
fn withdraw_payout_checks_delivered_amount() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let t = DealTerms { payout: PayoutTarget::Withdraw { account: supplier() }, ..escrow_terms() };
    let id = create(&mut c, &e, t);
    e.call(supplier());
    c.accept_deal(id);
    fund(&mut c, &e, id);
    e.call(buyer());
    c.confirm_delivery(id);
    e.callback(PromiseResult::Successful(b"\"0\"".to_vec())); // ft_transfer failed → Verifier refunded us
    assert!(!c.on_cash_transfer(id, true));
    assert_eq!(c.load(id.0).cash, CashLeg::Pending);
    e.call(stranger());
    c.resume(id);
    e.callback(PromiseResult::Successful(format!("\"{AMOUNT}\"").into_bytes()));
    assert!(c.on_cash_transfer(id, true));
    assert_eq!(state(&c, id), DealState::Settled);
}

// ===================== title leg =====================

#[test]
fn title_signature_built_in_contract_and_checked_by_ecrecover() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.accept_documents(id);
    let tx = sign_ok(&mut c, &e, id, LegKind::Main, 0);
    let buyer_evm = parse_address(BUYER_EVM).unwrap();
    assert_eq!(to_hex(&tx.to), T1_ESCROW);
    assert_eq!(tx.data, tradelock_evm::tradetrust::transfer_owners(&buyer_evm, &buyer_evm));
    assert_eq!(tx.chain_id, 11155111);
    assert!(matches!(c.load(id.0).title, TitleLeg::Signed { .. }));
    // fee bump / new nonce allowed after Signed
    let tx2 = sign_ok(&mut c, &e, id, LegKind::Main, 1);
    assert_ne!(tx.payload, tx2.payload);
    e.call(stranger());
    c.report_broadcast(id, format!("0x{}", "ab".repeat(32)));
    assert!(matches!(c.load(id.0).title, TitleLeg::Broadcast { .. }));
}

#[test]
fn wrong_key_or_failed_mpc_resets_to_pending() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.accept_documents(id);
    e.set(stranger(), 1, 300);
    let _ = c.request_title_signature(id, U64(0), U128(30_000_000_000), U128(1), U64(120_000));
    let TitleLeg::SignatureRequested { tx } = c.load(id.0).title else { panic!() };
    let other = SigningKey::from_bytes(&[9u8; 32].into()).unwrap();
    e.callback(PromiseResult::Successful(vec![]));
    assert!(!c.on_signature(id, LegKind::Main, U64(0), Ok(mock_mpc_response(&other, &tx.payload))));
    assert_eq!(c.load(id.0).title, TitleLeg::Pending);
    e.set(stranger(), 1, 300);
    let _ = c.request_title_signature(id, U64(0), U128(30_000_000_000), U128(1), U64(120_000));
    e.callback(PromiseResult::Failed);
    assert!(!c.on_signature(id, LegKind::Main, U64(0), Err(PromiseError::Failed)));
    assert_eq!(c.load(id.0).title, TitleLeg::Pending);
}

#[test]
fn title_tx_payload_matches_viem_vectors() {
    let v: serde_json::Value = serde_json::from_str(include_str!("../../tradelock-proof/tests/vectors/title_tx.json")).unwrap();
    let e = Env { now: T0 };
    e.call(me());
    for t in v["vectors"].as_array().unwrap() {
        let terms = EblTerms {
            chain_id: t["chain_id"].as_u64().unwrap(),
            factory: [1; 20],
            registry: [2; 20],
            token_id: [0; 32],
            token_id_dec: "0".into(),
            title_escrow: parse_address(t["to"].as_str().unwrap()).unwrap(),
            buyer_evm: [3; 20],
            supplier_evm: [4; 20],
            ship_by: 0,
            doc_acceptance_window_ns: 0,
            derived_address: None,
            accept_by: None,
        };
        let tx = title::build_title_tx(
            &terms,
            parse_address(t["destination"].as_str().unwrap()).unwrap(),
            t["nonce"].as_str().unwrap().parse().unwrap(),
            t["max_fee_per_gas"].as_str().unwrap().parse().unwrap(),
            t["max_priority_fee_per_gas"].as_str().unwrap().parse().unwrap(),
            t["gas_limit"].as_str().unwrap().parse().unwrap(),
        );
        assert_eq!(to_hex(&tx.data), t["data"].as_str().unwrap());
        assert_eq!(to_hex(&tx.payload), t["payload"].as_str().unwrap(), "{}", t["name"]);
    }
}
fails!(signature_request_in_flight_rejected, "LegInFlight", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.accept_documents(id);
    e.set(stranger(), 1, 300);
    let _ = c.request_title_signature(id, U64(0), U128(30_000_000_000), U128(1), U64(120_000));
    let _ = c.request_title_signature(id, U64(0), U128(30_000_000_000), U128(1), U64(120_000));
});
fails!(signature_request_needs_deposit, "InsufficientDeposit", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.accept_documents(id);
    e.set(stranger(), 0, 300);
    let _ = c.request_title_signature(id, U64(0), U128(30_000_000_000), U128(1), U64(120_000));
});
fails!(signature_request_fee_bound, "FeeOutOfBounds", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.accept_documents(id);
    e.set(stranger(), 1, 300);
    let _ = c.request_title_signature(id, U64(0), U128(200_000_000_001), U128(1), U64(120_000));
});
fails!(signature_request_before_settlement_rejected, "InvalidState", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.set(stranger(), 1, 300);
    let _ = c.request_title_signature(id, U64(0), U128(30_000_000_000), U128(1), U64(120_000));
});
fails!(signature_request_escrow_only_rejected, "InvalidState", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_escrow(&mut c, &e);
    e.call(buyer());
    c.confirm_delivery(id);
    e.set(stranger(), 1, 300);
    let _ = c.request_title_signature(id, U64(0), U128(30_000_000_000), U128(1), U64(120_000));
});

// ===================== settle / refund completion (D-019) =====================

#[test]
fn settle_completes_on_cash_and_buyer_title_confirmation() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.accept_documents(id);
    cash_ok(&mut c, &e, id);
    assert_eq!(state(&c, id), DealState::Settling); // title still open
    sign_ok(&mut c, &e, id, LegKind::Main, 0);
    e.call(supplier());
    assert!(!c.confirm_title_transferred(id, evb(200))); // not protected: needs arbiter too
    e.call(buyer());
    assert!(c.confirm_title_transferred(id, evb(201)));
    assert_eq!(state(&c, id), DealState::Settled);
    assert!(!c.confirm_title_transferred(id, evb(202))); // idempotent
}

#[test]
fn refund_completes_on_supplier_title_confirmation_or_buyer_plus_arbiter() {
    for solo in [true, false] {
        let e = Env { now: T0 };
        let mut c = new_contract(&e);
        let id = title_held(&mut c, &e);
        e.call(buyer());
        c.refuse_documents(id, None);
        cash_ok(&mut c, &e, id);
        if solo {
            e.call(supplier());
            assert!(c.confirm_title_transferred(id, evs(300)));
        } else {
            e.call(buyer());
            assert!(!c.confirm_title_transferred(id, evs(300)));
            e.call(arbiter());
            assert!(c.confirm_title_transferred(id, evs(300)));
        }
        assert_eq!(state(&c, id), DealState::Refunded);
    }
}

// ===================== redelivery (D-015) =====================

#[test]
fn redelivery_after_settled_two_rounds() {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.accept_documents(id);
    cash_ok(&mut c, &e, id);
    e.call(buyer());
    c.confirm_title_transferred(id, evb(1));
    assert_eq!(state(&c, id), DealState::Settled);
    for round in 1..=2u32 {
        e.call(buyer()); // buyer rejected the title on Sepolia; it is back at the deal address
        assert!(c.confirm_title_at_deal_address(id, evd(10)));
        assert!(!c.confirm_title_at_deal_address(id, evd(11))); // idempotent
        assert_eq!(c.load(id.0).redelivery.as_ref().unwrap().round, round);
        c.redeliver_title(id);
        c.redeliver_title(id); // idempotent
        let tx = sign_ok(&mut c, &e, id, LegKind::Redelivery, round as u64 + 5);
        let b = parse_address(BUYER_EVM).unwrap();
        assert_eq!(tx.data, tradelock_evm::tradetrust::transfer_owners(&b, &b)); // same stored destination
        e.call(buyer());
        assert!(c.confirm_title_transferred(id, evb(20)));
        assert_eq!(c.load(id.0).redelivery.as_ref().unwrap().leg, TitleLeg::Done);
        assert_eq!(state(&c, id), DealState::Settled);
    }
}
fails!(redelivery_by_supplier_after_settled_rejected, "Unauthorized", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.accept_documents(id);
    cash_ok(&mut c, &e, id);
    e.call(buyer());
    c.confirm_title_transferred(id, evb(1));
    c.confirm_title_at_deal_address(id, evd(2));
    e.call(supplier());
    c.redeliver_title(id);
});
fails!(redelivery_without_returned_title_rejected, "title not confirmed back", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = title_held(&mut c, &e);
    e.call(buyer());
    c.accept_documents(id);
    cash_ok(&mut c, &e, id);
    e.call(buyer());
    c.confirm_title_transferred(id, evb(1));
    c.redeliver_title(id);
});

/// T16: supplier handed the title over but nobody confirmed it before ship_by; after the refund the
/// supplier alone confirms it is at the deal address and gets it back.
#[test]
fn unconfirmed_handover_recovered_after_ship_by_refund() {
    let mut e = Env { now: T0 };
    let mut c = new_contract(&e);
    let id = funded_ebl(&mut c, &e);
    e.now = T0 + 7 * 86_400 * SEC;
    e.call(buyer());
    c.claim_timeout(id);
    cash_ok(&mut c, &e, id);
    assert_eq!(state(&c, id), DealState::Refunded);
    e.call(supplier());
    assert!(c.confirm_title_at_deal_address(id, evd(50)));
    c.redeliver_title(id);
    let tx = sign_ok(&mut c, &e, id, LegKind::Redelivery, 0);
    let s = parse_address(SUPPLIER_EVM).unwrap();
    assert_eq!(tx.data, tradelock_evm::tradetrust::transfer_owners(&s, &s));
}

// ===================== owner =====================

fails!(owner_methods_are_owner_only, "Unauthorized", {
    let e = Env { now: T0 };
    let mut c = new_contract(&e);
    e.call(stranger());
    c.set_paused(true);
});
