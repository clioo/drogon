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
        // Bulk trim: `drain` drops the overflow in one pass. The previous
        // per-byte `pop_front` trim made a single 2.5 MB/s session burn
        // ~45% of daemon CPU (R16-AT). (extend stays per-byte: VecDeque has
        // no extend_from_slice.)
        self.data.extend(bytes.iter().copied());
        self.end_cursor += bytes.len() as u64;
        let overflow = self.data.len().saturating_sub(self.capacity);
        if overflow > 0 {
            self.data.drain(..overflow);
            self.start_cursor += overflow as u64;
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
        // Contiguous-slice copies: the previous per-byte iterator collect
        // charged every read O(retained) steps, and an active pane following
        // a flood pulls the ring constantly (R16-AT). A wrapped VecDeque
        // splits at `front.len()`, so the logical offset may start inside
        // `back` — handle both regions explicitly.
        let (front, back) = self.data.as_slices();
        let mut bytes = Vec::with_capacity(take);
        let from_front = take.min(front.len().saturating_sub(offset));
        if from_front > 0 {
            bytes.extend_from_slice(&front[offset..offset + from_front]);
        }
        let skip_back = offset.saturating_sub(front.len());
        let from_back = take - from_front;
        if from_back > 0 {
            bytes.extend_from_slice(&back[skip_back..skip_back + from_back]);
        }
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
    fn a_push_larger_than_capacity_keeps_only_the_newest_tail() {
        let mut ring = RingBuffer {
            capacity: 4,
            data: VecDeque::new(),
            start_cursor: 0,
            end_cursor: 0,
        };
        ring.push(b"abcdefghijklmnop");
        assert_eq!(ring.start_cursor, 12);
        assert_eq!(ring.end_cursor, 16);
        let outcome = ring.read(0, 10).expect("not a future cursor");
        assert!(outcome.truncated);
        assert_eq!(outcome.start_cursor, 12);
        assert_eq!(outcome.bytes, b"mnop");
    }

    #[test]
    fn reads_match_a_reference_model_across_wrapped_layouts() {
        // Model the retained window independently and compare reads at every
        // cursor and limit. The VecDeque's physical layout (front/back
        // split) depends on its internal growth, so exercise enough varied
        // push/drain sequences to wrap it several different ways.
        let sequences: Vec<Vec<&[u8]>> = vec![
            vec![b"abc", b"de", b"fghij", b"kl", b"mnopqrst"],
            vec![b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", b"b", b"c", b"ddddd", b"eeeeeeeeeeee"],
            vec![b"x", b"y", b"z"],
            vec![b"0123456789"; 12],
        ];
        for pushes in sequences {
            let mut ring = RingBuffer {
                capacity: 16,
                data: VecDeque::new(),
                start_cursor: 0,
                end_cursor: 0,
            };
            let mut absolute: Vec<u8> = Vec::new();
            for chunk in pushes {
                ring.push(chunk);
                absolute.extend_from_slice(chunk);
            }
            let retained = absolute.len().saturating_sub(16);
            let retained_bytes = &absolute[retained..];
            let start = ring.start_cursor;
            let end = ring.end_cursor;
            assert_eq!(end - start, retained_bytes.len() as u64);
            for cursor in start..=end {
                for limit in [1usize, 3, 16, 64] {
                    let outcome = ring.read(cursor, limit).expect("cursor in range");
                    let from = (cursor - start) as usize;
                    let expected = &retained_bytes[from..(from + limit.min(retained_bytes.len() - from)).min(retained_bytes.len())];
                    assert_eq!(
                        outcome.bytes,
                        expected,
                        "cursor {cursor} limit {limit}: ring {:?} model {:?}",
                        outcome.bytes,
                        expected,
                    );
                    assert_eq!(outcome.truncated, cursor < start);
                }
            }
        }
    }

    #[test]
    fn randomized_sequences_match_the_reference_model() {
        // xorshift32, seeded: reproducible coverage of arbitrary push sizes
        // (and therefore arbitrary front/back physical splits).
        let mut state = 0xC0FFEE_u32;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state
        };
        for round in 0..50 {
            let mut ring = RingBuffer {
                capacity: 16,
                data: VecDeque::new(),
                start_cursor: 0,
                end_cursor: 0,
            };
            let mut absolute: Vec<u8> = Vec::new();
            for _ in 0..(5 + next() % 20) {
                let len = 1 + (next() % 24) as usize;
                let byte = (round % 251) as u8;
                let chunk = vec![byte; len];
                ring.push(&chunk);
                absolute.extend_from_slice(&chunk);
            }
            let retained_from = absolute.len().saturating_sub(16);
            let retained = absolute[retained_from..].to_vec();
            let start = ring.start_cursor;
            let end = ring.end_cursor;
            assert_eq!(end - start, retained.len() as u64, "round {round}");
            let mut cursor = start;
            while cursor < end {
                let limit = 1 + (next() % 20) as usize;
                let outcome = ring.read(cursor, limit).expect("cursor in range");
                let from = (cursor - start) as usize;
                let want = &retained[from..retained.len().min(from + limit)];
                assert_eq!(outcome.bytes, want, "round {round} cursor {cursor}");
                assert!(!outcome.truncated, "round {round} cursor {cursor}");
                cursor = outcome.next_cursor.max(cursor + 1);
            }
        }
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

