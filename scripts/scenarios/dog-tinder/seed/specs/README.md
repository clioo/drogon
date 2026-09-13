# Specs

The product owner drops a spec in here. A bot watches this folder's
`dog-tinder.md` with a `local_file_digest.v1` monitor: when the file changes,
the bot wakes up, opens a worktree and runs the work — implementation first,
then the bounded adversarial rounds — without anyone asking it to.
