//! Addresses under which other devices of the network reach this computer.

use std::net::{IpAddr, Ipv4Addr};

/// An IPv4 address another device can use: not loopback, unspecified or
/// link-local.
pub(crate) fn is_usable_ipv4(address: IpAddr) -> bool {
    let IpAddr::V4(address) = address else {
        return false;
    };
    !address.is_loopback() && !address.is_unspecified() && !address.is_link_local()
}

/// Address of the interface that routes outside traffic. Connecting a UDP
/// socket sends nothing; it only selects the interface.
fn routed_ipv4() -> Option<Ipv4Addr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(address) if is_usable_ipv4(IpAddr::V4(address)) => Some(address),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn adapter_ipv4_addresses() -> Vec<Ipv4Addr> {
    let Ok(adapters) = ipconfig::get_adapters() else {
        return Vec::new();
    };
    adapters
        .iter()
        .flat_map(|adapter| adapter.ip_addresses())
        .filter_map(|address| match address {
            IpAddr::V4(address) if is_usable_ipv4(IpAddr::V4(*address)) => Some(*address),
            _ => None,
        })
        .collect()
}

/// Linux: only the routed interface; there is no adapter listing without
/// extra dependencies, and the routed one is the one other devices use.
#[cfg(not(target_os = "windows"))]
fn adapter_ipv4_addresses() -> Vec<Ipv4Addr> {
    Vec::new()
}

/// Every usable IPv4 address of this computer, the routed one first.
pub(crate) fn local_ipv4_addresses() -> Vec<Ipv4Addr> {
    let mut addresses: Vec<Ipv4Addr> = routed_ipv4().into_iter().collect();
    for address in adapter_ipv4_addresses() {
        if !addresses.contains(&address) {
            addresses.push(address);
        }
    }
    addresses
}

/// Address to show in the links of this server.
pub(crate) fn local_network_ip() -> String {
    local_ipv4_addresses()
        .first()
        .map(ToString::to_string)
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

#[cfg(test)]
mod tests {
    use super::is_usable_ipv4;

    #[test]
    fn rejects_loopback_and_link_local_addresses() {
        assert!(!is_usable_ipv4("127.0.0.1".parse().expect("loopback address")));
        assert!(!is_usable_ipv4("169.254.10.20".parse().expect("link-local address")));
        assert!(is_usable_ipv4("192.168.1.42".parse().expect("LAN address")));
        assert!(!is_usable_ipv4("::1".parse().expect("IPv6 loopback address")));
    }
}
