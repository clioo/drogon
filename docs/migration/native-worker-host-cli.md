# Native worker CLI configuration

The Unix daemon configures workers with the validated `drogon-cli` sibling of
its own running executable. It does not search inherited PATH or the current
workspace for this authority-bearing executable. A missing sibling preserves
ordinary daemon startup but worker launch remains explicitly unsupported.
An unreadable or invalid sibling fails configuration rather than falling back.

A compiled-daemon/socket regression uses isolated copied executables with an
empty environment and covers both sibling-present and sibling-absent startup.
Before wiring, the present case returned `unsupported_feature`; after wiring it
reaches the real task validation (`task_not_found`) without creating a session.
The initial test used a generic missing-record code and was corrected to the
existing task domain's exact code. All six authentication/configuration socket
tests and the complete daemon crate suite pass. This is configuration evidence,
not a real-model launch or completed mail-runtime acceptance. The current Unix
transport limitation and disabled native coordination capability remain explicit.
