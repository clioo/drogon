//! `mentu.*` RPC glue (journey J9): validates params, resolves the
//! workspace and recipe, and delegates to `crate::mentu::{recipe, runtime,
//! execution, storage}`. Registered in `lib.rs`'s `CAPABILITIES` and
//! `dispatch_inner`.

use std::path::PathBuf;

use drogon_protocol::mentu::{
    MentuApproval, MentuApproveParams, MentuApproveResult, MentuCancelResult, MentuRecipeParams,
    MentuRecipeResult, MentuRecipeSaveParams, MentuRecipeSaveResult, MentuRecipesResult,
    MentuRunEvidenceParams, MentuRunEvidenceResult, MentuRunIdParams, MentuRunParams,
    MentuRunResult, MentuRunStatus, MentuRunsParams, MentuRunsResult, MentuRuntimeResult,
    MentuWorkspaceScopeParams,
};
use drogon_protocol::{Request, RpcError};
use serde_json::Value;

use crate::mentu::{execution, recipe, run_record, runtime, storage};
use crate::{Engine, error, workspace};

fn parse<T: serde::de::DeserializeOwned>(params: &Value, what: &str) -> Result<T, RpcError> {
    serde_json::from_value(params.clone())
        .map_err(|_| error::invalid_argument(format!("Invalid {what} params.")))
}

fn to_value<T: serde::Serialize>(value: T) -> Result<Value, RpcError> {
    serde_json::to_value(value).map_err(|e| error::internal_error(e.to_string()))
}

impl Engine {
    pub(crate) fn mentu_recipes(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: MentuWorkspaceScopeParams = parse(params, "mentu.recipes")?;
        parsed.validate()?;
        let workspace_path = {
            let conn = self.db.lock().unwrap();
            workspace::get_path(&conn, &parsed.workspace_id)?
        };
        let recipes = recipe::discover_recipes(&PathBuf::from(workspace_path))?;
        to_value(MentuRecipesResult { recipes })
    }

    pub(crate) fn mentu_recipe(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: MentuRecipeParams = parse(params, "mentu.recipe")?;
        parsed.validate()?;
        let workspace_path = {
            let conn = self.db.lock().unwrap();
            workspace::get_path(&conn, &parsed.workspace_id)?
        };
        let detail = recipe::load_recipe(&PathBuf::from(workspace_path), &parsed.recipe_id)?;
        to_value(MentuRecipeResult { recipe: detail })
    }

    pub(crate) fn mentu_runtime_info(&self, _params: &Value) -> Result<Value, RpcError> {
        let info = runtime::runtime_info(self.data_dir());
        to_value(MentuRuntimeResult { runtime: info })
    }

    pub(crate) fn mentu_recipe_save(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, Self::do_mentu_recipe_save)
    }

    fn do_mentu_recipe_save(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: MentuRecipeSaveParams = parse(params, "mentu.recipe_save")?;
        parsed.validate()?;
        let workspace_path = {
            let conn = self.db.lock().unwrap();
            workspace::get_path(&conn, &parsed.workspace_id)?
        };
        let workspace_root = PathBuf::from(workspace_path);
        let detail = recipe::save_recipe(&workspace_root, &parsed.recipe_id, &parsed.content)?;
        {
            let conn = self.db.lock().unwrap();
            storage::invalidate_stale_approvals(
                &conn,
                &parsed.workspace_id,
                &parsed.recipe_id,
                &detail.content_hash,
            )?;
        }
        to_value(MentuRecipeSaveResult { recipe: detail })
    }

    pub(crate) fn mentu_approve(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, Self::do_mentu_approve)
    }

    fn do_mentu_approve(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: MentuApproveParams = parse(params, "mentu.approve")?;
        parsed.validate()?;
        let workspace_path = {
            let conn = self.db.lock().unwrap();
            workspace::get_path(&conn, &parsed.workspace_id)?
        };
        let current_hash =
            recipe::current_content_hash(&PathBuf::from(workspace_path), &parsed.recipe_id)?;
        if current_hash != parsed.content_hash {
            return Err(error::invalid_argument(
                "Recipe content changed since it was loaded; reload and approve the current content.",
            ));
        }
        let approval = MentuApproval {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: parsed.workspace_id.clone(),
            recipe_id: parsed.recipe_id.clone(),
            content_hash: parsed.content_hash.clone(),
            approved_at: crate::now_rfc3339(),
        };
        {
            let conn = self.db.lock().unwrap();
            storage::insert_approval(&conn, &approval)?;
        }
        to_value(MentuApproveResult { approval })
    }

    pub(crate) fn mentu_run(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, Self::do_mentu_run)
    }

    fn do_mentu_run(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: MentuRunParams = parse(params, "mentu.run")?;
        parsed.validate()?;
        let workspace_path = {
            let conn = self.db.lock().unwrap();
            workspace::get_path(&conn, &parsed.workspace_id)?
        };
        let workspace_root = PathBuf::from(workspace_path);
        let recipe_path = recipe::resolve_recipe_path(&workspace_root, &parsed.recipe_id)?;
        let runtime_path = runtime::require_verified_runtime(self.data_dir())?;
        let current_hash = recipe::current_content_hash(&workspace_root, &parsed.recipe_id)?;
        let stored_hash = {
            let conn = self.db.lock().unwrap();
            storage::consume_approval(
                &conn,
                &parsed.approval_id,
                &parsed.workspace_id,
                &parsed.recipe_id,
            )?
        };
        if stored_hash != current_hash {
            return Err(error::invalid_argument(
                "Recipe content changed since approval; re-approve before running.",
            ));
        }
        let run = execution::launch_run(
            self.db_handle(),
            runtime_path,
            workspace_root,
            parsed.workspace_id.clone(),
            parsed.recipe_id.clone(),
            parsed.approval_id.clone(),
            None,
            execution::Invocation::Run {
                recipe_path: &recipe_path,
            },
        )?;
        to_value(MentuRunResult { run })
    }

    pub(crate) fn mentu_runs(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: MentuRunsParams = parse(params, "mentu.runs")?;
        let limit = parsed.validate()?;
        let conn = self.db.lock().unwrap();
        // Ensures the workspace still exists (and surfaces `not_found`
        // honestly) without otherwise using its path.
        workspace::get_path(&conn, &parsed.workspace_id)?;
        let runs = storage::list_runs(&conn, &parsed.workspace_id, limit)?;
        to_value(MentuRunsResult { runs })
    }

    pub(crate) fn mentu_run_status(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: MentuRunIdParams = parse(params, "mentu.run_status")?;
        parsed.validate()?;
        let conn = self.db.lock().unwrap();
        let run = storage::get_run(&conn, &parsed.run_id)?
            .ok_or_else(|| error::not_found("Mentu run not found."))?;
        to_value(MentuRunResult { run })
    }

    pub(crate) fn mentu_run_evidence(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: MentuRunEvidenceParams = parse(params, "mentu.run_evidence")?;
        parsed.validate()?;
        let (workspace_id, mentu_run_id) = {
            let conn = self.db.lock().unwrap();
            let run = storage::get_run(&conn, &parsed.run_id)?
                .ok_or_else(|| error::not_found("Mentu run not found."))?;
            (run.workspace_id, run.mentu_run_id)
        };
        let workspace_path = {
            let conn = self.db.lock().unwrap();
            workspace::get_path(&conn, &workspace_id)?
        };
        let Some(mentu_run_id) = mentu_run_id else {
            return Err(error::invalid_argument(
                "This run never produced a Mentu run id to retry.",
            ));
        };
        let workspace_root = PathBuf::from(workspace_path);
        let evidence =
            run_record::read_run_evidence(&workspace_root, &mentu_run_id)?.unwrap_or_default();
        to_value(MentuRunEvidenceResult {
            run_id: parsed.run_id,
            mentu_run_id: Some(mentu_run_id),
            evidence,
        })
    }

    pub(crate) fn mentu_retry(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, Self::do_mentu_retry)
    }

    fn do_mentu_retry(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: MentuRunIdParams = parse(params, "mentu.retry")?;
        parsed.validate()?;
        let (prior, workspace_path) = {
            let conn = self.db.lock().unwrap();
            let prior = storage::get_run(&conn, &parsed.run_id)?
                .ok_or_else(|| error::not_found("Mentu run not found."))?;
            let path = workspace::get_path(&conn, &prior.workspace_id)?;
            (prior, path)
        };
        if prior.status == MentuRunStatus::Running {
            return Err(error::invalid_argument(
                "This run is still in progress; cancel it before retrying.",
            ));
        }
        let mentu_run_id = prior.mentu_run_id.clone().ok_or_else(|| {
            error::invalid_argument("This run never produced a Mentu run id to retry.")
        })?;
        let runtime_path = runtime::require_verified_runtime(self.data_dir())?;
        let run = execution::launch_run(
            self.db_handle(),
            runtime_path,
            PathBuf::from(workspace_path),
            prior.workspace_id.clone(),
            prior.recipe_id.clone(),
            prior.approval_id.clone(),
            Some(prior.id.clone()),
            execution::Invocation::Resume {
                mentu_run_id: &mentu_run_id,
            },
        )?;
        to_value(MentuRunResult { run })
    }

    pub(crate) fn mentu_cancel(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, Self::do_mentu_cancel)
    }

    fn do_mentu_cancel(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: MentuRunIdParams = parse(params, "mentu.cancel")?;
        parsed.validate()?;
        // Best-effort: kills the tracked child if this process still holds
        // it. The row's status transitions to `cancelled` asynchronously,
        // once the background watcher observes the exit — the caller polls
        // `mentu.run_status` to see it land, same as `run`/`retry`.
        execution::cancel(&parsed.run_id);
        let conn = self.db.lock().unwrap();
        let run = storage::get_run(&conn, &parsed.run_id)?
            .ok_or_else(|| error::not_found("Mentu run not found."))?;
        to_value(MentuCancelResult { run })
    }
}
