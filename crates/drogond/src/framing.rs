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
    // The same bound the wire applies to requests holds for what this side
    // writes: an oversized result is replaced by an error answering the same
    // request, so the caller learns why instead of seeing the connection
    // drop ("service disconnected").
    if bytes.len() > MAX_FRAME_BYTES {
        let refusal = Response::failure(
            response.request_id.clone(),
            drogon_protocol::RpcError::new(
                "response_too_large",
                format!(
                    "the reply ({:.1} MB) is over the {} MB limit of one answer; narrow the request",
                    bytes.len() as f64 / (1024.0 * 1024.0),
                    MAX_FRAME_BYTES / (1024 * 1024)
                ),
            ),
        );
        bytes = serde_json::to_vec(&refusal)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
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
    fn an_oversized_reply_becomes_an_error_for_the_same_request() {
        let big = serde_json::json!({ "blob": "x".repeat(MAX_FRAME_BYTES + 1) });
        let mut out = Vec::new();
        write_response(&mut out, &Response::success("req-1", big)).unwrap();
        assert!(out.len() < 1024, "the refusal is small");
        let answer: serde_json::Value = serde_json::from_slice(&out[..out.len() - 1]).unwrap();
        assert_eq!(answer["requestId"], "req-1");
        assert_eq!(answer["ok"], false);
        assert_eq!(answer["error"]["code"], "response_too_large");
        assert!(
            answer["error"]["message"]
                .as_str()
                .unwrap()
                .contains("over the 1 MB limit")
        );
    }

    #[test]
    fn clean_eof_with_no_data_is_none() {
        let mut reader = Cursor::new(Vec::<u8>::new());
        assert!(read_frame(&mut reader).unwrap().is_none());
    }
}
