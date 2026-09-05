//! Bounded per-session byte ring buffer. `protocol-v1.md`: "A byte ring
//! buffer keeps the latest 1 MiB per session ... Cursors are monotonically
//! increasing absolute byte offsets. Old cursor returns retained tail with
//! `truncated:true` ... future cursor is an error ... Truncation never means
//! process exit." This module only ever drops the *oldest* bytes; it never
//! observes or affects the child process.

use std::collections::VecDeque;

pub(crate) const CAPACITY_BYTES: usize = 1024 * 1024;

pub(crate) struct RingBuffer {
    capacity: usize,
    data: VecDeque<u8>,
    /// Absolute offset of `data[0]`, i.e. the oldest byte still retained.
    start_cursor: u64,
    /// Absolute offset one past the last byte ever written.
    end_cursor: u64,
}

pub(crate) struct ReadOutcome {
    pub(crate) start_cursor: u64,
    pub(crate) next_cursor: u64,
    pub(crate) truncated: bool,
    pub(crate) bytes: Vec<u8>,
}

impl RingBuffer {
    pub(crate) fn new() -> Self {
        Self {
            capacity: CAPACITY_BYTES,
            data: VecDeque::with_capacity(CAPACITY_BYTES.min(64 * 1024)),
            start_cursor: 0,
            end_cursor: 0,
        }
    }

    pub(crate) fn push(&mut self, bytes: &[u8]) {
        self.data.extend(bytes.iter().copied());
        self.end_cursor += bytes.len() as u64;
        while self.data.len() > self.capacity {
            self.data.pop_front();
            self.start_cursor += 1;
        }
    }

    #[allow(dead_code)]
    pub(crate) fn end_cursor(&self) -> u64 {
        self.end_cursor
    }

    /// `None` iff `cursor` is strictly in the future (past every byte ever
    /// written so far) — the caller maps that to `invalid_argument`.
    pub(crate) fn read(&self, cursor: u64, limit: usize) -> Option<ReadOutcome> {
        if cursor > self.end_cursor {
            return None;
        }
        let effective_cursor = cursor.max(self.start_cursor);
        let truncated = cursor < self.start_cursor;
        let offset = (effective_cursor - self.start_cursor) as usize;
        let available = self.data.len().saturating_sub(offset);
        let take = available.min(limit.max(1));
        let bytes: Vec<u8> = self.data.iter().skip(offset).take(take).copied().collect();
        let next_cursor = effective_cursor + bytes.len() as u64;
        Some(ReadOutcome {
            start_cursor: effective_cursor,
            next_cursor,
            truncated,
            bytes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn future_cursor_is_none() {
        let ring = RingBuffer::new();
        assert!(ring.read(1, 10).is_none());
        assert!(ring.read(0, 10).is_some());
    }

    #[test]
    fn truncates_and_reports_actual_start() {
        let mut ring = RingBuffer {
            capacity: 4,
            data: VecDeque::new(),
            start_cursor: 0,
            end_cursor: 0,
        };
        ring.push(b"abcdefgh");
        assert_eq!(ring.start_cursor, 4);
        assert_eq!(ring.end_cursor, 8);
        let outcome = ring.read(0, 10).expect("not a future cursor");
        assert!(outcome.truncated);
        assert_eq!(outcome.start_cursor, 4);
        assert_eq!(outcome.bytes, b"efgh");
        assert_eq!(outcome.next_cursor, 8);
    }

    #[test]
    fn limit_bounds_the_slice_without_truncated_flag() {
        let mut ring = RingBuffer::new();
        ring.push(b"hello world");
        let outcome = ring.read(0, 5).unwrap();
        assert!(!outcome.truncated);
        assert_eq!(outcome.bytes, b"hello");
        assert_eq!(outcome.next_cursor, 5);
    }
}
