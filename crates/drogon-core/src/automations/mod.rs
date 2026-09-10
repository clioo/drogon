//! Global automation records and storage, plus the daemon-owned cron tick
//! loop ([`scheduler`]) and the bot-free dispatch path ([`direct`]) that
//! standalone `automation.*` RPCs and the scheduler share.

pub mod direct;
pub mod execution;
pub mod records;
pub mod runner;
pub mod scheduler;
pub mod storage;
pub mod timezone;
