use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

/// `drogond`: the Drogon terminal/session service. Foreground process;
/// owns SQLite and PTYs under `--data-dir`. See `docs/migration/protocol-v1.md`.
#[derive(Parser)]
#[command(name = "drogond")]
struct Args {
    #[arg(long)]
    data_dir: PathBuf,
}

fn main() -> ExitCode {
    let args = Args::parse();
    match drogond::serve(&args.data_dir) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("drogond: {e}");
            ExitCode::FAILURE
        }
    }
}
