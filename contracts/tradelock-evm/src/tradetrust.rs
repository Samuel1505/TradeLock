//! TradeTrust token-registry v5.5.2 calldata (DECISIONS V-09, V-10).

use crate::Address;

/// `transferOwners(address,address,bytes)` selector.
pub const TRANSFER_OWNERS_SELECTOR: [u8; 4] = [0x34, 0x42, 0x7f, 0x61];

/// ABI-encode `TitleEscrow.transferOwners(nominee, new_holder, remark = 0x)`.
/// Layout: selector ‖ nominee ‖ new_holder ‖ offset(0x60) ‖ len(0). Remark is always empty (V-09).
pub fn transfer_owners(nominee: &Address, new_holder: &Address) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + 32 * 4);
    out.extend_from_slice(&TRANSFER_OWNERS_SELECTOR);
    out.extend_from_slice(&[0u8; 12]);
    out.extend_from_slice(nominee);
    out.extend_from_slice(&[0u8; 12]);
    out.extend_from_slice(new_holder);
    let mut offset = [0u8; 32];
    offset[31] = 0x60;
    out.extend_from_slice(&offset);
    out.extend_from_slice(&[0u8; 32]); // bytes length = 0
    out
}

/// OpenZeppelin minimal-proxy init code around the implementation (Clones v5).
const CLONE_PREFIX: [u8; 20] = [0x3d, 0x60, 0x2d, 0x80, 0x60, 0x0a, 0x3d, 0x39, 0x81, 0xf3, 0x36, 0x3d, 0x3d, 0x37, 0x3d, 0x3d, 0x3d, 0x36, 0x3d, 0x73];
const CLONE_SUFFIX: [u8; 15] = [0x5a, 0xf4, 0x3d, 0x82, 0x80, 0x3e, 0x90, 0x3d, 0x91, 0x60, 0x2b, 0x57, 0xfd, 0x5b, 0xf3];

/// TitleEscrow address for (registry, token_id) created by `factory` (D-021):
/// `Clones.predictDeterministicAddress(implementation, keccak256(registry ‖ tokenId), factory)`.
/// `token_id` is the big-endian uint256.
pub fn predict_title_escrow(
    factory: &Address,
    implementation: &Address,
    registry: &Address,
    token_id: &[u8; 32],
    keccak256: impl Fn(&[u8]) -> [u8; 32],
) -> Address {
    let mut salt_input = [0u8; 52];
    salt_input[..20].copy_from_slice(registry);
    salt_input[20..].copy_from_slice(token_id);
    let salt = keccak256(&salt_input);

    let mut init_code = Vec::with_capacity(55);
    init_code.extend_from_slice(&CLONE_PREFIX);
    init_code.extend_from_slice(implementation);
    init_code.extend_from_slice(&CLONE_SUFFIX);
    let init_hash = keccak256(&init_code);

    let mut buf = Vec::with_capacity(85);
    buf.push(0xff);
    buf.extend_from_slice(factory);
    buf.extend_from_slice(&salt);
    buf.extend_from_slice(&init_hash);
    let h = keccak256(&buf);
    let mut out = [0u8; 20];
    out.copy_from_slice(&h[12..]);
    out
}

/// Decimal uint256 string → 32-byte big-endian. Rejects empty, non-digits and overflow.
pub fn parse_u256_dec(s: &str) -> Result<[u8; 32], String> {
    if s.is_empty() || s.len() > 78 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("invalid uint256: {s}"));
    }
    let mut out = [0u8; 32];
    for d in s.bytes() {
        let mut carry = (d - b'0') as u32;
        for byte in out.iter_mut().rev() {
            let v = (*byte as u32) * 10 + carry;
            *byte = (v & 0xff) as u8;
            carry = v >> 8;
        }
        if carry != 0 {
            return Err(format!("uint256 overflow: {s}"));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_address;

    fn keccak(data: &[u8]) -> [u8; 32] {
        use tiny_keccak::{Hasher, Keccak};
        let mut k = Keccak::v256();
        let mut out = [0u8; 32];
        k.update(data);
        k.finalize(&mut out);
        out
    }

    /// Real T1 deployment on Sepolia (docs/DEPLOYMENTS.md): official factory, its implementation,
    /// our registry, the minted token → the TitleEscrow that actually holds the eBL.
    #[test]
    fn predicts_real_t1_title_escrow() {
        let got = predict_title_escrow(
            &parse_address("0xfcafea839e576967b96ad1FBFB52b5CA26cd1D25").unwrap(),
            &parse_address("0x3781bd0bbd15bf5e45c7296115821933d47362be").unwrap(),
            &parse_address("0x4e95A0b956d5CADeD0864Df2D26a508257BeC811").unwrap(),
            &parse_u256_dec("99341760963449555253449397465407527918038632140097791491231289799516335410376").unwrap(),
            keccak,
        );
        assert_eq!(got, parse_address("0x9E549E4467e013e71F87402CBDc5c6E438E7f193").unwrap());
    }

    #[test]
    fn parse_u256_bounds() {
        assert_eq!(parse_u256_dec("0").unwrap(), [0u8; 32]);
        let mut one = [0u8; 32];
        one[31] = 1;
        assert_eq!(parse_u256_dec("1").unwrap(), one);
        let max = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
        assert_eq!(parse_u256_dec(max).unwrap(), [0xffu8; 32]);
        assert!(parse_u256_dec("115792089237316195423570985008687907853269984665640564039457584007913129639936").is_err());
        assert!(parse_u256_dec("").is_err());
        assert!(parse_u256_dec("12a").is_err());
    }

    #[test]
    fn transfer_owners_layout() {
        let a = [0x11u8; 20];
        let b = [0x22u8; 20];
        let data = transfer_owners(&a, &b);
        assert_eq!(data.len(), 132);
        assert_eq!(&data[..4], &TRANSFER_OWNERS_SELECTOR);
        assert_eq!(&data[16..36], &a);
        assert_eq!(&data[48..68], &b);
        assert_eq!(data[99], 0x60);
        assert!(data[100..].iter().all(|x| *x == 0));
    }
}
