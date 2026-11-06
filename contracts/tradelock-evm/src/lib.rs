//! Pure building blocks for the Tradelock title leg. No NEAR or host dependencies: callers pass the
//! keccak256 implementation (`env::keccak256_array` inside contracts), so the same code is unit-testable.

pub mod address;
pub mod tradetrust;
pub mod tx;

/// 20-byte EVM address.
pub type Address = [u8; 20];

/// Parse "0x" + 40 hex chars (case-insensitive, checksum not enforced).
pub fn parse_address(s: &str) -> Result<Address, String> {
    let h = s.strip_prefix("0x").ok_or_else(|| format!("address must start with 0x: {s}"))?;
    if h.len() != 40 {
        return Err(format!("address must be 20 bytes: {s}"));
    }
    let mut out = [0u8; 20];
    for (i, chunk) in h.as_bytes().chunks(2).enumerate() {
        let hi = hex_val(chunk[0]).ok_or_else(|| format!("invalid hex in address: {s}"))?;
        let lo = hex_val(chunk[1]).ok_or_else(|| format!("invalid hex in address: {s}"))?;
        out[i] = (hi << 4) | lo;
    }
    Ok(out)
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

/// Lowercase "0x…" hex.
pub fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(2 + bytes.len() * 2);
    s.push_str("0x");
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}
