//! A bind alone misses existing Windows IPv6 dual-stack listeners. Read only
//! their socket table while the caller holds a non-listening IPv4 reservation.
use std::{
    io::{self, ErrorKind},
    mem::{offset_of, size_of},
    net::Ipv6Addr,
};
use windows_sys::Win32::{
    Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS},
    NetworkManagement::IpHelper::{GetTcp6Table, MIB_TCP6ROW, MIB_TCP6TABLE, MIB_TCP_STATE_LISTEN},
};

const TABLE_LIMIT: usize = 1024 * 1024;
const ROW_OFFSET: usize = offset_of!(MIB_TCP6TABLE, table);
const _: () = assert!(std::mem::align_of::<MIB_TCP6TABLE>() <= std::mem::align_of::<u64>());

pub(crate) fn ensure_no_ipv6_listener(port: u16) -> io::Result<()> {
    read_table(port, |table, size| unsafe { GetTcp6Table(table, size, 0) })
}

fn read_table(
    port: u16,
    mut query: impl FnMut(*mut MIB_TCP6TABLE, &mut u32) -> u32,
) -> io::Result<()> {
    let mut needed = size_of::<MIB_TCP6TABLE>() as u32;
    // The table can grow between sizing and reading. Bound both retries and
    // allocation; errors or incomplete data must never mean "no listener".
    for _ in 0..3 {
        if !(ROW_OFFSET..=TABLE_LIMIT).contains(&(needed as usize)) {
            return Err(io::Error::new(
                ErrorKind::InvalidData,
                "IPv6 socket table size is outside the safe probe limit",
            ));
        }
        let mut buffer = vec![0u64; (needed as usize).div_ceil(size_of::<u64>())];
        let capacity = buffer.len() * size_of::<u64>();
        let mut size = capacity as u32;
        match query(buffer.as_mut_ptr().cast(), &mut size) {
            ERROR_INSUFFICIENT_BUFFER => needed = size,
            ERROR_SUCCESS => return check_table(&buffer, size as usize, port),
            error => return Err(io::Error::from_raw_os_error(error as i32)),
        }
    }
    Err(io::Error::new(
        ErrorKind::WouldBlock,
        "IPv6 socket table kept changing; port availability is unconfirmed",
    ))
}

fn check_table(buffer: &[u64], size: usize, port: u16) -> io::Result<()> {
    let invalid = || io::Error::new(ErrorKind::InvalidData, "IPv6 socket table is incomplete");
    if size < ROW_OFFSET || size > std::mem::size_of_val(buffer) {
        return Err(invalid());
    }
    let bytes = buffer.as_ptr().cast::<u8>();
    // Read fields/rows by value only after bounds checks. Do not construct a
    // Rust reference pretending the SDK's one-row flexible array is longer.
    let count = unsafe { bytes.cast::<u32>().read_unaligned() } as usize;
    let end = count
        .checked_mul(size_of::<MIB_TCP6ROW>())
        .and_then(|rows| ROW_OFFSET.checked_add(rows))
        .ok_or_else(invalid)?;
    if end > size {
        return Err(invalid());
    }
    for index in 0..count {
        let row = unsafe {
            bytes
                .add(ROW_OFFSET + index * size_of::<MIB_TCP6ROW>())
                .cast::<MIB_TCP6ROW>()
                .read_unaligned()
        };
        // The SDK specifies network byte order and says the upper 16 port bits
        // may contain garbage. A native IPv6 address cannot serve IPv4 clients.
        if row.State == MIB_TCP_STATE_LISTEN && u16::from_be(row.dwLocalPort as u16) == port {
            let address = Ipv6Addr::from(unsafe { row.LocalAddr.u.Byte });
            if address.is_unspecified() || address.to_ipv4_mapped().is_some() {
                // This API cannot distinguish V6ONLY on a wildcard listener.
                // Conservatively leave that port unconfirmed, never kill it.
                return Err(ErrorKind::AddrInUse.into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        MIB_TCP_STATE_ESTAB, MIB_TCP_STATE_TIME_WAIT,
    };

    fn row(address: Ipv6Addr, port: u16, state: i32) -> MIB_TCP6ROW {
        // The ABI record contains integer fields and byte-array unions only.
        let mut row: MIB_TCP6ROW = unsafe { std::mem::zeroed() };
        row.State = state;
        row.LocalAddr.u.Byte = address.octets();
        row.dwLocalPort = u32::from(port.to_be()) | 0xabcd0000;
        row
    }

    fn write_rows(table: *mut MIB_TCP6TABLE, size: &mut u32, rows: &[MIB_TCP6ROW]) -> u32 {
        let required = ROW_OFFSET + std::mem::size_of_val(rows);
        if (*size as usize) < required {
            *size = required as u32;
            return ERROR_INSUFFICIENT_BUFFER;
        }
        assert_eq!(table as usize % std::mem::align_of::<MIB_TCP6TABLE>(), 0);
        unsafe {
            table.cast::<u32>().write(rows.len() as u32);
            for (index, row) in rows.iter().enumerate() {
                table
                    .cast::<u8>()
                    .add(ROW_OFFSET + index * size_of::<MIB_TCP6ROW>())
                    .cast::<MIB_TCP6ROW>()
                    .write_unaligned(*row);
            }
        }
        *size = required as u32;
        ERROR_SUCCESS
    }

    #[test]
    fn blocks_wildcard_and_mapped_listeners_but_not_native_ipv6() {
        for (address, blocked) in [
            (Ipv6Addr::UNSPECIFIED, true),
            (Ipv4Addr::LOCALHOST.to_ipv6_mapped(), true),
            (Ipv4Addr::new(192, 0, 2, 1).to_ipv6_mapped(), true),
            (Ipv6Addr::LOCALHOST, false),
            ("2001:db8::1".parse().unwrap(), false),
        ] {
            let row = row(address, 28766, MIB_TCP_STATE_LISTEN);
            let result = read_table(28766, |table, size| write_rows(table, size, &[row]));
            assert_eq!(result.is_err(), blocked, "{address}: {result:?}");
            if blocked {
                assert_eq!(result.unwrap_err().kind(), ErrorKind::AddrInUse);
            }
        }
    }

    #[test]
    fn ignores_other_ports_and_closed_listener_connections() {
        let rows = [
            row(Ipv6Addr::UNSPECIFIED, 28767, MIB_TCP_STATE_LISTEN),
            row(Ipv6Addr::UNSPECIFIED, 28766, MIB_TCP_STATE_TIME_WAIT),
            row(
                Ipv4Addr::LOCALHOST.to_ipv6_mapped(),
                28766,
                MIB_TCP_STATE_ESTAB,
            ),
        ];
        read_table(28766, |table, size| write_rows(table, size, &rows)).unwrap();
        read_table(28766, |table, size| write_rows(table, size, &[])).unwrap();
    }

    #[test]
    fn api_failure_is_inconclusive_even_with_an_empty_buffer() {
        assert_eq!(
            read_table(28766, |_, _| 5).unwrap_err().raw_os_error(),
            Some(5)
        );
    }

    #[test]
    fn rejects_oversized_truncated_and_invalid_counts() {
        assert_eq!(
            read_table(28766, |_, size| {
                *size = TABLE_LIMIT as u32 + 1;
                ERROR_INSUFFICIENT_BUFFER
            })
            .unwrap_err()
            .kind(),
            ErrorKind::InvalidData
        );
        for reported in [0, u32::MAX] {
            assert_eq!(
                read_table(28766, |_, size| {
                    *size = reported;
                    ERROR_SUCCESS
                })
                .unwrap_err()
                .kind(),
                ErrorKind::InvalidData
            );
        }
        assert_eq!(
            read_table(28766, |table, _| {
                unsafe {
                    table.cast::<u32>().write(u32::MAX);
                }
                ERROR_SUCCESS
            })
            .unwrap_err()
            .kind(),
            ErrorKind::InvalidData
        );
    }

    #[test]
    fn bounded_retry_handles_growth_without_treating_it_as_release() {
        let mut calls = 0;
        let occupied = row(Ipv6Addr::UNSPECIFIED, 28766, MIB_TCP_STATE_LISTEN);
        let result = read_table(28766, |table, size| {
            calls += 1;
            if calls < 3 {
                *size *= 2;
                ERROR_INSUFFICIENT_BUFFER
            } else {
                write_rows(table, size, &[occupied])
            }
        });
        assert_eq!(calls, 3);
        assert_eq!(result.unwrap_err().kind(), ErrorKind::AddrInUse);
        let mut calls = 0;
        assert_eq!(
            read_table(28766, |_, _| {
                calls += 1;
                ERROR_INSUFFICIENT_BUFFER
            })
            .unwrap_err()
            .kind(),
            ErrorKind::WouldBlock
        );
        assert_eq!(calls, 3);
    }
}
