//! EIP-1559 transaction fields and signing payload via omni-transaction 0.5.0 (DECISIONS V-04).

use crate::Address;
use omni_transaction::{TransactionBuilder, TxBuilder, EVM};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Eip1559Fields {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_priority_fee_per_gas: u128,
    pub max_fee_per_gas: u128,
    pub gas_limit: u64,
    pub to: Address,
    pub value: u128,
    pub data: Vec<u8>,
}

impl Eip1559Fields {
    /// `0x02 ‖ rlp([chain_id, nonce, max_priority_fee, max_fee, gas_limit, to, value, data, []])`.
    pub fn unsigned_bytes(&self) -> Vec<u8> {
        TransactionBuilder::new::<EVM>()
            .chain_id(self.chain_id)
            .nonce(self.nonce)
            .max_priority_fee_per_gas(self.max_priority_fee_per_gas)
            .max_fee_per_gas(self.max_fee_per_gas)
            .gas_limit(self.gas_limit as u128)
            .to(self.to)
            .value(self.value)
            .input(self.data.clone())
            .access_list(vec![])
            .build()
            .build_for_signing()
    }

    /// keccak256 of the unsigned bytes: the 32-byte payload the MPC signs.
    pub fn signing_payload(&self, keccak256: impl FnOnce(&[u8]) -> [u8; 32]) -> [u8; 32] {
        keccak256(&self.unsigned_bytes())
    }
}
