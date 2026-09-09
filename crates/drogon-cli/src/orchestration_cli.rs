//! Clap grammar for the native orchestration subcommands, split out of
//! `cli.rs` so the nested 18-verb surface stays domain-specific. Scope flags
//! are flattened arg groups shared by the verbs that need them. All
//! orchestration validation lives in `orchestration_commands` (it needs
//! environment hints); only pure grammar goes here.

use clap::{Args, Subcommand, ValueEnum};

/// Explicit execution-host override. Absent means: use the scoped
/// `DROGON_HOST_ID` hint when present, else the connected runtime's own host
/// identity from the read-only preflight.
#[derive(Args, Debug, Default)]
pub struct HostOpt {
    /// Execution host id (defaults to the scoped hint or the connected host)
    #[arg(long, value_name = "ID")]
    pub host: Option<String>,
}

/// Coordinator binding flags. There is no client binding store and no
/// default-to-latest behavior: these are required verbatim on every
/// coordinator-scope verb.
#[derive(Args, Debug)]
pub struct CoordinatorScopeArgs {
    /// Run id of the coordination run
    #[arg(long, value_name = "ID")]
    pub run: String,
    /// Coordinator binding id (opaque, returned by run-create)
    #[arg(long, value_name = "ID")]
    pub coordinator_id: String,
    /// Consumer generation fence known to this coordinator
    #[arg(long, value_name = "N")]
    pub consumer_generation: u64,
}

/// Why one flat group: dual-actor verbs (send/check/reply/ask/request-show)
/// accept either the coordinator binding or the dispatch binding, and clap
/// forbids two flattened groups reusing the same flag name (--run).
/// Scoped worker context environment hints (DROGON_RUN_ID/TASK_ID/
/// DISPATCH_ID) fill dispatch-scope gaps; explicit flags and hints must
/// agree, and hints never grant authority.
#[derive(Args, Debug, Default)]
pub struct ActorScopeArgs {
    /// Coordinator binding: run id
    #[arg(long, value_name = "ID")]
    pub run: Option<String>,
    #[arg(long, value_name = "ID")]
    pub coordinator_id: Option<String>,
    #[arg(long, value_name = "N")]
    pub consumer_generation: Option<u64>,
    /// Dispatch binding: task id
    #[arg(long, visible_alias = "task-id", value_name = "ID")]
    pub task: Option<String>,
    /// Dispatch binding: dispatch id
    #[arg(long, visible_alias = "dispatch-id", value_name = "ID")]
    pub dispatch: Option<String>,
}

impl ActorScopeArgs {
    pub fn coordinator(&self) -> OptionalCoordinatorScope {
        OptionalCoordinatorScope {
            run: self.run.clone(),
            coordinator_id: self.coordinator_id.clone(),
            consumer_generation: self.consumer_generation,
        }
    }

    pub fn dispatch(&self) -> DispatchScope {
        DispatchScope {
            run: self.run.clone(),
            task: self.task.clone(),
            dispatch: self.dispatch.clone(),
        }
    }
}

/// Coordinator binding triple (optional fields).
#[derive(Debug, Default, Clone)]
pub struct OptionalCoordinatorScope {
    pub run: Option<String>,
    pub coordinator_id: Option<String>,
    pub consumer_generation: Option<u64>,
}

/// Dispatch binding triple (optional fields; hints may fill gaps).
#[derive(Debug, Default, Clone)]
pub struct DispatchScope {
    pub run: Option<String>,
    pub task: Option<String>,
    pub dispatch: Option<String>,
}

#[derive(ValueEnum, Debug, Clone, Copy)]
pub enum StatusArg {
    Pending,
    Ready,
    Dispatched,
    Completed,
    Failed,
    Blocked,
}

impl StatusArg {
    pub fn as_wire(self) -> &'static str {
        match self {
            StatusArg::Pending => "pending",
            StatusArg::Ready => "ready",
            StatusArg::Dispatched => "dispatched",
            StatusArg::Completed => "completed",
            StatusArg::Failed => "failed",
            StatusArg::Blocked => "blocked",
        }
    }
}

#[derive(ValueEnum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageKindArg {
    Status,
    Question,
    Answer,
    Heartbeat,
    #[value(alias = "worker_done")]
    FinalReport,
    Guidance,
    Escalation,
}

impl MessageKindArg {
    pub fn as_wire(self) -> &'static str {
        match self {
            MessageKindArg::Status => "status",
            MessageKindArg::Question => "question",
            MessageKindArg::Answer => "answer",
            MessageKindArg::Heartbeat => "heartbeat",
            MessageKindArg::FinalReport => "finalReport",
            MessageKindArg::Guidance => "guidance",
            MessageKindArg::Escalation => "escalation",
        }
    }
}

#[derive(ValueEnum, Debug, Clone, Copy)]
pub enum OutcomeArg {
    Succeeded,
    Failed,
}

impl OutcomeArg {
    pub fn as_wire(self) -> &'static str {
        match self {
            OutcomeArg::Succeeded => "succeeded",
            OutcomeArg::Failed => "failed",
        }
    }
}

#[derive(ValueEnum, Debug, Clone, Copy, Default)]
pub enum OutputSourceArg {
    #[default]
    Auto,
    Terminal,
    Transcript,
}

impl OutputSourceArg {
    pub fn as_wire(self) -> &'static str {
        match self {
            OutputSourceArg::Auto => "auto",
            OutputSourceArg::Terminal => "terminal",
            OutputSourceArg::Transcript => "transcript",
        }
    }
}

#[derive(ValueEnum, Debug, Clone, Copy)]
pub enum ReceiptScopeArg {
    Bootstrap,
    Coordinator,
    Dispatch,
}

impl ReceiptScopeArg {
    pub fn as_wire(self) -> &'static str {
        match self {
            ReceiptScopeArg::Bootstrap => "bootstrap",
            ReceiptScopeArg::Coordinator => "coordinator",
            ReceiptScopeArg::Dispatch => "dispatch",
        }
    }
}

#[derive(Subcommand, Debug)]
pub enum OrchestrationCommand {
    /// Create a run bound to a coordinator (initial generation is server-owned)
    RunCreate {
        /// Run objective (free text, forwarded literally)
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        objective: String,
        /// Coordinator binding id; generated and returned when omitted
        #[arg(long, value_name = "ID")]
        coordinator_id: Option<String>,
        #[command(flatten)]
        host: HostOpt,
    },
    /// List runs (bounded pagination, default limit 100)
    RunList {
        #[arg(long, value_name = "N")]
        limit: Option<u32>,
        #[arg(long, value_name = "TOKEN")]
        cursor: Option<String>,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Show one run
    RunShow {
        #[arg(long, visible_alias = "id", value_name = "ID")]
        run: String,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Bind this coordinator to a run (takeover explicitly advances the fence)
    RunUse {
        #[command(flatten)]
        scope: CoordinatorScopeArgs,
        #[arg(long, default_value_t = false)]
        takeover: bool,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Create a task with an immutable spec
    TaskCreate {
        #[command(flatten)]
        scope: CoordinatorScopeArgs,
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        instructions: String,
        #[arg(long, value_name = "TEXT")]
        title: Option<String>,
        /// Comma-separated prerequisite task ids
        #[arg(long, value_name = "ID,..")]
        depends_on: Option<String>,
        #[arg(long, value_name = "ID")]
        parent: Option<String>,
        #[arg(long, value_name = "TEXT")]
        display_name: Option<String>,
        #[command(flatten)]
        host: HostOpt,
    },
    /// List tasks in the bound run
    TaskList {
        #[command(flatten)]
        scope: CoordinatorScopeArgs,
        #[arg(long, default_value_t = false)]
        brief: bool,
        /// Shorthand for --status ready
        #[arg(long, default_value_t = false)]
        ready: bool,
        #[arg(long, value_enum)]
        status: Option<StatusArg>,
        #[arg(long, value_name = "N")]
        limit: Option<u32>,
        #[arg(long, value_name = "TOKEN")]
        cursor: Option<String>,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Show one task with its full spec and attempt history
    TaskShow {
        #[command(flatten)]
        scope: CoordinatorScopeArgs,
        #[arg(long, value_name = "ID")]
        task: String,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Start exactly one worker attempt in a registered workspace
    WorkerStart {
        #[command(flatten)]
        scope: CoordinatorScopeArgs,
        #[arg(long, value_name = "ID")]
        task: String,
        /// Registered workspace id (folder or Git worktree)
        #[arg(long, value_name = "ID")]
        workspace: String,
        /// Fresh launch: harness id (exclusive with --reuse-session)
        #[arg(long, value_name = "ID")]
        harness: Option<String>,
        #[arg(long, value_name = "MODEL-ID")]
        model: Option<String>,
        /// Adapter-specific effort value (fresh launches only; requires --model)
        #[arg(long, value_name = "VALUE")]
        effort: Option<String>,
        #[arg(long, value_name = "PROVIDER")]
        provider: Option<String>,
        /// Permission mode for fresh launches (default inherit); any
        /// explicitly supplied value — including inherit — is a fresh-only
        /// preference and is refused on reuse
        #[arg(long, value_enum)]
        permission_mode: Option<crate::cli::PermissionModeArg>,
        /// Explicit reuse of an existing session (exclusive with --harness)
        #[arg(long, value_name = "SESSION-ID")]
        reuse_session: Option<String>,
        #[arg(long, value_name = "INCARNATION")]
        reuse_incarnation: Option<String>,
        #[arg(long, value_name = "TEXT")]
        display_name: Option<String>,
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        comment: Option<String>,
        #[arg(long, value_name = "MS")]
        timeout_ms: Option<u32>,
        /// Explicitly replaced prior attempt (latest failed/stopped/abandoned)
        #[arg(long, value_name = "DISPATCH-ID")]
        retry_of: Option<String>,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Show one worker attempt with exact session identity
    WorkerShow {
        #[command(flatten)]
        scope: CoordinatorScopeArgs,
        #[arg(long, value_name = "ID")]
        dispatch: String,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Read bounded worker output with opaque cursors
    WorkerRead {
        #[command(flatten)]
        scope: CoordinatorScopeArgs,
        #[arg(long, value_name = "ID")]
        dispatch: String,
        #[arg(long, value_name = "TOKEN")]
        cursor: Option<String>,
        #[arg(long, value_name = "N")]
        limit: Option<u32>,
        #[arg(long, value_enum, default_value_t = OutputSourceArg::Auto)]
        source: OutputSourceArg,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Stop a worker: fence commits before any signal attempt
    WorkerStop {
        #[command(flatten)]
        scope: CoordinatorScopeArgs,
        #[arg(long, value_name = "ID")]
        dispatch: String,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Abandon a worker without ever signalling its process
    WorkerAbandon {
        #[command(flatten)]
        scope: CoordinatorScopeArgs,
        #[arg(long, value_name = "ID")]
        dispatch: String,
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        reason: Option<String>,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Release a settled worker's resources (retained/no-owned-resource honest)
    WorkerRelease {
        #[command(flatten)]
        scope: CoordinatorScopeArgs,
        #[arg(long, value_name = "ID")]
        dispatch: String,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Send a scoped coordination message
    Send {
        /// Actor scope: coordinator binding or dispatch binding
        #[command(flatten)]
        actor: ActorScopeArgs,
        #[arg(long, visible_alias = "type", value_enum)]
        kind: MessageKindArg,
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        subject: String,
        /// run-home | dispatch:ID | group:NAME
        #[arg(long, value_name = "TARGET")]
        to: Option<String>,
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        body: Option<String>,
        /// Structured payload as a JSON object
        #[arg(long, value_name = "JSON")]
        payload: Option<String>,
        #[arg(long, value_name = "ID")]
        thread_id: Option<String>,
        /// Final-report outcome (required for --kind final-report)
        #[arg(long, value_enum)]
        outcome: Option<OutcomeArg>,
        /// Final-report result metadata as a JSON object
        #[arg(long, value_name = "JSON")]
        result: Option<String>,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Consume or inspect the actor's mailbox (whole-FIFO batch, explicit ACK)
    Check {
        #[command(flatten)]
        actor: ActorScopeArgs,
        /// Non-consuming inspection of unread mail
        #[arg(long, default_value_t = false)]
        peek: bool,
        /// Non-consuming inspection of all retained mail
        #[arg(long, default_value_t = false)]
        all: bool,
        /// Acknowledge a prior whole-batch delivery, then consume (unread)
        #[arg(long, value_name = "DELIVERY-ID")]
        ack: Option<String>,
        /// Wait for the first matching message (unread mode only)
        #[arg(long, default_value_t = false)]
        wait: bool,
        /// Positive bounded wait budget in ms (required with --wait, <= 900000)
        #[arg(long, value_name = "MS")]
        timeout_ms: Option<u32>,
        /// Comma-separated wake kinds; never a local filter on consuming output
        #[arg(long, visible_alias = "types", value_name = "KIND,..")]
        kinds: Option<String>,
        #[arg(long, default_value_t = false)]
        inject: bool,
        /// Inspection-only continuation cursor (peek/all only)
        #[arg(long, value_name = "TOKEN")]
        cursor: Option<String>,
        /// Inspection-only page bound (peek/all only)
        #[arg(long, value_name = "N")]
        limit: Option<u32>,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Answer a question, retaining its correlation id
    Reply {
        #[command(flatten)]
        actor: ActorScopeArgs,
        #[arg(long, visible_alias = "id", value_name = "MSG-ID")]
        question: String,
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        body: String,
        #[arg(long, value_name = "ID")]
        thread_id: Option<String>,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Ask a question (commit + bounded wait) or resume a pending one
    Ask {
        #[command(flatten)]
        actor: ActorScopeArgs,
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        question: Option<String>,
        /// Answer choice; repeatable (new questions only)
        #[arg(long, value_name = "TEXT")]
        option: Vec<String>,
        /// Comma-separated answer choices (source CLI spelling; new questions only)
        #[arg(long, value_name = "CSV", conflicts_with = "option")]
        options: Option<String>,
        /// run-home | dispatch:ID (new questions only)
        #[arg(long, value_name = "TARGET")]
        to: Option<String>,
        /// Resume an existing pending question by its message id
        #[arg(long, value_name = "MSG-ID")]
        resume: Option<String>,
        /// Positive bounded wait budget in ms (default 10 minutes, <= 900000)
        #[arg(long, value_name = "MS", default_value_t = 600_000)]
        timeout_ms: u32,
        #[command(flatten)]
        host: HostOpt,
    },
    /// Recover a receipt by id from an explicit receipt scope
    RequestShow {
        /// Target receipt id (distinct from the --request-id envelope id)
        #[arg(long, value_name = "ID")]
        request: String,
        #[arg(long, value_enum)]
        scope: ReceiptScopeArg,
        /// Binding fields for the coordinator/dispatch receipt scopes
        #[command(flatten)]
        actor: ActorScopeArgs,
        /// Coordinator id for the bootstrap receipt scope
        #[arg(long, value_name = "ID")]
        bootstrap_coordinator_id: Option<String>,
        #[command(flatten)]
        host: HostOpt,
    },
}
