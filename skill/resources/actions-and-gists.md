# Actions, gists, notifications, checks

## GitHub Actions

| Goal | Call |
|---|---|
| list workflows | `GET /repos/{owner}/{repo}/actions/workflows` |
| one workflow | `GET /repos/{owner}/{repo}/actions/workflows/{file_name_or_id}` |
| recent runs | `GET /repos/{owner}/{repo}/actions/runs` — `query: { per_page: 20, branch: 'main', status: 'failure' }` |
| one run | `GET /repos/{owner}/{repo}/actions/runs/{run_id}` |
| jobs of a run | `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs` |
| job logs | `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs` |
| trigger a run | `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` |
| cancel a run | `POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel` |
| re-run | `POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun` |
| artifacts | `GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts` |
| repo secrets | `GET|PUT /repos/{owner}/{repo}/actions/secrets` |

Dispatch payload — the workflow file must already contain
`on: workflow_dispatch`:

```json
{ "ref": "main", "inputs": { "environment": "production" } }
```

Success is `204` with no body. A `404` here usually means the workflow has no
`workflow_dispatch` trigger, not that it is missing.

`status` filter values: `queued`, `in_progress`, `completed`, `success`,
`failure`, `cancelled`, `skipped`. `run.conclusion` is `null` while running.

Logs endpoint returns a redirect to a zip for completed runs; reading it through
`github_api` gives you HTML/`302` text, so for triage prefer
`GET .../jobs` and read `steps[].conclusion` — it names the failing step without
the download.

Workflow secrets via this API need `encryption` (libsodium sealed box). If the user
wants to set a secret, explain that it cannot be done with a plain JSON body from
here, and point at the repo's Settings → Secrets page instead of trying and failing.

## Gists

| Goal | Call |
|---|---|
| list mine | `GET /gists` — `query: { per_page: 30 }` |
| list a user's | `GET /users/{login}/gists` |
| one | `GET /gists/{gist_id}` |
| create | `POST /gists` |
| edit | `PATCH /gists/{gist_id}` |
| delete | `DELETE /gists/{gist_id}` |

Create payload:

```json
{ "description": "…", "public": false,
  "files": { "note.md": { "content": "# hello" } } }
```

Edit replaces the whole `files` map: keep the filename key and pass new
`content`; omit a file to delete it. Gist creation needs the `gist` scope —
without it the API answers `404`, not `403`.

## Notifications

| Goal | Call |
|---|---|
| list | `GET /notifications` — `query: { all: false, per_page: 50, participating: false }` |
| mark one read | `PATCH /notifications/threads/{thread_id}` |
| mark all read | `PUT /notifications` — `body: { last_read_at: '<ISO>' }` |
| thread subscription | `PUT|DELETE /notifications/threads/{thread_id}/subscription` |
| repo notifications | `GET /repos/{owner}/{repo}/notifications` |

Unread only by default. A `PUT /notifications` without `last_read_at` marks
**everything** read — that is a bulk state change; confirm first.

## Checks

| Goal | Call |
|---|---|
| check runs for a ref | `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` |
| check suites | `GET /repos/{owner}/{repo}/commits/{ref}/check-suites` |
| combined status | `GET /repos/{owner}/{repo}/commits/{ref}/status` |

`check-runs` needs the `checks:read` permission on the token (public repos allow
it anonymously; private ones need it granted). `status` here refers to the legacy
commit-status API and is what branch protection usually gates on.

## What this skill deliberately does not cover

Webhooks, app installations, repository rulesets, packages, and code scanning
need admin or app credentials this token usually lacks. If a request needs them,
say which credential is missing rather than attempting the call — a `403` here
reads like a bug to the user.
