//! Newline-delimited JSON framing bounded to `MAX_FRAME_BYTES` *before*
//! allocation grows further, per `protocol-v1.md`. `read_frame` uses
//! `Read::take` so a frame with no newline within the budget is rejected
//! without ever buffering past the limit.

use std::io::{self, BufRead, Read, Write};

use drogon_protocol::{MAX_FRAME_BYTES, Response};

pub fn read_frame(reader: &mut dyn BufRead) -> io::Result<Option<Vec<u8>>> {
    let mut buf = Vec::new();
    // Why `&mut dyn BufRead` rather than a generic `impl BufRead`: taking
    // ownership of the reader by value (as `Read::take` requires) is only
    // unambiguous when the only `Sized` candidate receiver is the reference
    // itself, which is true for a trait object but not for a generic `R`
    // (where method resolution instead tries to move `*reader: R` out from
    // behind the reference and fails to borrow-check).
    let mut limited = Read::take(reader, MAX_FRAME_BYTES as u64 + 1);
    let n = limited.read_until(b'\n', &mut buf)?;
    if n == 0 {
        return Ok(None);
    }
    if buf.last() != Some(&b'\n') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame exceeded MAX_FRAME_BYTES without a terminating newline",
        ));
    }
    buf.pop();
    Ok(Some(buf))
}

pub fn write_response(writer: &mut impl Write, response: &Response) -> io::Result<()> {
    let mut bytes =
        serde_json::to_vec(response).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    // Defensive: the same bound the wire applies to requests should hold
    // for what this side ever writes, so a bug that builds an oversized
    // result never silently produces a frame no compliant reader accepts.
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "refusing to write a response frame exceeding MAX_FRAME_BYTES",
        ));
    }
    bytes.push(b'\n');
    writer.write_all(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn oversized_frame_without_newline_is_rejected() {
        let body = vec![b'a'; MAX_FRAME_BYTES + 10];
        let mut reader = Cursor::new(body);
        let result = read_frame(&mut reader);
        assert!(result.is_err());
    }

    #[test]
    fn a_frame_at_exactly_the_limit_is_accepted() {
        let mut body = vec![b'a'; MAX_FRAME_BYTES];
        body.push(b'\n');
        let mut reader = Cursor::new(body);
        let frame = read_frame(&mut reader).unwrap().unwrap();
        assert_eq!(frame.len(), MAX_FRAME_BYTES);
    }

    #[test]
    fn clean_eof_with_no_data_is_none() {
        let mut reader = Cursor::new(Vec::<u8>::new());
        assert!(read_frame(&mut reader).unwrap().is_none());
    }
}
