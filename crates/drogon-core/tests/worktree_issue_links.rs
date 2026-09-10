use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

fn call(engine: &Engine, method: &str, params: Value) -> drogon_protocol::Response {
    let request: Request = serde_json::from_value(json!({ "protocol": PROTOCOL_VERSION, "requestId": uuid::Uuid::new_v4().to_string(), "method": method, "params": params })).unwrap();
    engine.dispatch(request)
}
fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let response = call(engine, method, params);
    assert!(response.ok, "{method}: {:?}", response.error);
    response.result.unwrap()
}
fn folder(engine: &Engine, path: &std::path::Path) -> (String, String) {
    let project = ok(engine, "project.add", json!({"path": path}));
    let listed = ok(engine, "worktree.list", json!({"projectId": project["id"]}));
    (
        project["id"].as_str().unwrap().into(),
        listed["worktrees"][0]["id"].as_str().unwrap().into(),
    )
}
fn issue(provider: &str, identifier: &str) -> Value {
    json!({"provider": provider, "identifier": identifier, "title": "Persisted issue title", "url": null})
}

#[test]
fn associations_are_durable_provider_specific_and_scoped_to_real_folder_worktrees() {
    let data = tempfile::tempdir().unwrap();
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let (project, worktree, other_project);
    {
        let engine = Engine::open(data.path()).unwrap();
        (project, worktree) = folder(&engine, first.path());
        (other_project, _) = folder(&engine, second.path());
        let linked = ok(
            &engine,
            "worktree.linkIssue",
            json!({"worktreeId": worktree, "issue": issue("linear", "ENG-123")}),
        );
        assert_eq!(linked["identifier"], "ENG-123");
        assert_eq!(linked["worktreeId"], worktree);
        ok(
            &engine,
            "worktree.linkIssue",
            json!({"worktreeId": worktree, "issue": issue("jira", "KAN-1")}),
        );
        assert_eq!(
            ok(
                &engine,
                "worktree.issueLinks",
                json!({"projectId": other_project})
            )["links"],
            json!([])
        );
    }
    let engine = Engine::open(data.path()).unwrap();
    let links = ok(
        &engine,
        "worktree.issueLinks",
        json!({"projectId": project}),
    );
    assert_eq!(links["links"].as_array().unwrap().len(), 2);
    ok(
        &engine,
        "worktree.linkIssue",
        json!({"worktreeId": worktree, "issue": issue("linear", "ENG-124")}),
    );
    let links = ok(
        &engine,
        "worktree.issueLinks",
        json!({"projectId": project}),
    );
    assert_eq!(links["links"].as_array().unwrap().len(), 2);
    assert!(
        links["links"]
            .as_array()
            .unwrap()
            .iter()
            .any(|l| l["identifier"] == "ENG-124")
    );
    ok(
        &engine,
        "worktree.unlinkIssue",
        json!({"worktreeId": worktree, "provider": "linear"}),
    );
    let links = ok(
        &engine,
        "worktree.issueLinks",
        json!({"projectId": project}),
    );
    assert_eq!(links["links"].as_array().unwrap().len(), 1);
    assert_eq!(links["links"][0]["provider"], "jira");
    assert!(first.path().exists());
}

#[test]
fn registry_revision_tracks_card_properties_and_issue_associations() {
    let data = tempfile::tempdir().unwrap();
    let path = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let (_, worktree) = folder(&engine, path.path());
    let before = ok(&engine, "project.changes", json!({}));
    ok(
        &engine,
        "worktree.update",
        json!({"worktreeId": worktree, "isPinned": true}),
    );
    let pinned = ok(&engine, "project.changes", json!({}));
    ok(
        &engine,
        "worktree.linkIssue",
        json!({"worktreeId": worktree, "issue": issue("linear", "ENG-123")}),
    );
    let linked = ok(&engine, "project.changes", json!({}));
    ok(
        &engine,
        "worktree.unlinkIssue",
        json!({"worktreeId": worktree, "provider": "linear"}),
    );
    let unlinked = ok(&engine, "project.changes", json!({}));
    assert_ne!(
        before, pinned,
        "CLI card property changes must refresh other clients"
    );
    assert_ne!(pinned, linked, "linking an issue must refresh the sidebar");
    assert_eq!(
        pinned, unlinked,
        "removing the association restores the same visible registry"
    );
}

#[test]
fn invalid_links_and_unknown_owners_cannot_mutate_associations() {
    let data = tempfile::tempdir().unwrap();
    let path = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let (project, worktree) = folder(&engine, path.path());
    for url in [
        "javascript:alert(1)",
        "file:///private/data",
        "https://not-linear.example/issue/ENG-1",
        "https://linear.app\\evil/issue/ENG-1",
    ] {
        let mut details = issue("linear", "ENG-1");
        details["url"] = json!(url);
        let response = call(
            &engine,
            "worktree.linkIssue",
            json!({"worktreeId": worktree, "issue": details}),
        );
        assert!(!response.ok, "accepted unsafe URL: {url}");
        assert_eq!(response.error.unwrap().code, "invalid_argument");
    }
    for url in [
        "https://:",
        "https://[invalid]",
        "https://example.com:99999",
        "https://user:password@example.com/browse/KAN-1",
    ] {
        let mut details = issue("jira", "KAN-1");
        details["url"] = json!(url);
        let response = call(
            &engine,
            "worktree.linkIssue",
            json!({"worktreeId": worktree, "issue": details}),
        );
        assert!(!response.ok, "accepted malformed Jira URL: {url}");
    }
    let read = call(
        &engine,
        "worktree.issueLinks",
        json!({"projectId": project, "hostId": "remote"}),
    );
    assert!(
        !read.ok,
        "an unsupported host selector must not read the local registry"
    );
    let response = call(
        &engine,
        "worktree.linkIssue",
        json!({"worktreeId": "foreign", "issue": issue("jira", "KAN-1")}),
    );
    assert!(!response.ok);
    assert_eq!(response.error.unwrap().code, "not_found");
    assert_eq!(
        ok(
            &engine,
            "worktree.issueLinks",
            json!({"projectId": project})
        )["links"],
        json!([])
    );
}
