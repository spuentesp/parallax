# GitLab merge request reviews

Add a GitLab HTTPS repository URL to a workspace. Open merge requests appear in the request picker, and their URLs can also be submitted to the assessment API, MCP tool, or an explicit chat request such as `Review https://gitlab.com/group/project/-/merge_requests/12`. Nested groups are supported.

Set `PARALLAX_GITLAB_READ_TOKEN` to a token able to read merge requests and repository comparisons. For a self-managed instance, set both `PARALLAX_GITLAB_HOST` to its hostname and `PARALLAX_GITLAB_API_BASE` to its API v4 URL. Only URLs on the configured host are accepted. The read token and write token are separate.

For automatic CI, configure `PARALLAX_GITLAB_WRITE_TOKEN`, `PARALLAX_GITLAB_WEBHOOK_SECRET`, and the public Parallax URL. Add a GitLab project webhook targeting `/webhooks/gitlab`, enable merge request events, and configure the same secret token. Turn on auto CI in the workspace. Forks and drafts are ignored; a draft is evaluated when marked ready. Results are commit pipeline statuses, with a merge request note when comments are enabled. GitLab represents inconclusive results as `failed`, because its commit status API has no `error` state.

The assessment pins the target and source commits when it starts. Code impact compares those commits using the GitLab repository comparison API; unavailable diffs and comparison limits are reported. Interrupted evaluations and unpublished results resume on startup. The implementation has been exercised against an HTTP stand-in; a real GitLab deployment still needs its own credential and webhook verification.
