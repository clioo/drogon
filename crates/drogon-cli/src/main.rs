use std::process::ExitCode;

use drogon_cli::cli::Cli;
use drogon_cli::error::CliError;

fn main() -> ExitCode {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(err) => {
            // clap maps help/version to 0 and parse failures to 2 already.
            err.exit();
        }
    };
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("error: cannot start async runtime: {err}");
            return ExitCode::from(1);
        }
    };
    match runtime.block_on(drogon_cli::commands::run(&cli)) {
        Ok(outcome) => {
            if !outcome.stdout.is_empty() {
                println!("{}", outcome.stdout);
            }
            if let Some(note) = outcome.stderr_note {
                eprintln!("{note}");
            }
            ExitCode::from(outcome.exit_code)
        }
        Err(err) => {
            report(&err, cli.json);
            ExitCode::from(err.exit_code())
        }
    }
}

/// Error output rules:
/// - usage errors: text on stderr, exit 2, stdout untouched;
/// - operation/transport failures: under `--json` the failure envelope goes to
///   stdout (the caller's parseable channel), otherwise `error: code: message`
///   on stderr. Both exit 1.
fn report(err: &CliError, json: bool) {
    if let CliError::Usage(message) = err {
        eprintln!("error: {message}");
        return;
    }
    if let (true, Some(envelope)) = (json, err.failure_envelope()) {
        match serde_json::to_string_pretty(&envelope) {
            Ok(payload) => {
                println!("{payload}");
                return;
            }
            Err(encode_err) => {
                eprintln!("error: cannot encode failure envelope: {encode_err}");
                return;
            }
        }
    }
    eprintln!("error: {}", err.rpc_error());
}
