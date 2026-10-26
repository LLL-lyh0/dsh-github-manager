# Issues and pull requests

Both are "issues" in GitHub's data model; PRs just carry extra fields. `GET
/repos/{owner}/{repo}/issues` returns **both** — filter with
`query: { pulls: 'false' }` or `{ pulls: 'true' }`, or use the dedicated
`/pulls` routes.

## Issues

| Goal | Call |
|---|---|
| list | `GET /repos/{owner}/{repo}/issues` — `query: { state: 'open', per_page: 50, labels: 'bug,help wanted', sort: 'updated' }` |
| one | `GET /repos/{owner}/{repo}/issues/{number}` |
| create | `POST /repos/{owner}/{repo}/issues` — `{ title, body, labels: ['bug'], assignees: ['login'], milestone }` |
| edit | `PATCH /repos/{owner}/{repo}/issues/{number}` — `{ title, body, state: 'closed', state_reason: 'completed', labels, assignees }` |
| close | `PATCH` with `{ state: 'closed' }` |
| comments | `GET|POST /repos/{owner}/{repo}/issues/{number}/comments` — `{ body }` |
| edit/delete a comment | `PATCH|DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}` |

`state_reason` accepts `completed`, `not_planned`, `reopened`. Body is Markdown.
`labels` in a `PATCH` **replaces** the whole set — read the current labels first if
you mean to add one.

Issue `body` may be `null`. Treat `null` and `''` the same when summarising.

## Labels and milestones

- `GET|POST /repos/{owner}/{repo}/labels` — create with `{ name, color: 'ff0000', description }`
- `PUT /repos/{owner}/{repo}/issues/{number}/labels` with `{ labels: [...] }` replaces all;
  `POST` on the same route adds without removing.
- `GET|POST /repos/{owner}/{repo}/milestones` — `{ title, due_on, description }`

## Pull requests

| Goal | Call |
|---|---|
| list | `GET /repos/{owner}/{repo}/pulls` — `query: { state: 'open', per_page: 50, sort: 'updated', direction: 'desc' }` |
| one (mergeability) | `GET /repos/{owner}/{repo}/pulls/{number}` |
| files changed | `GET /repos/{owner}/{repo}/pulls/{number}/files` |
| commits | `GET /repos/{owner}/{repo}/pulls/{number}/commits` |
| create | `POST /repos/{owner}/{repo}/pulls` |
| edit | `PATCH /repos/{owner}/{repo}/pulls/{number}` — `{ title, body, state: 'closed', base }` |
| merge | `PUT /repos/{owner}/{repo}/pulls/{number}/merge` |
| reviews | `GET|POST /repos/{owner}/{repo}/pulls/{number}/reviews` |
| review comments | `GET|POST /repos/{owner}/{repo}/pulls/{number}/comments` |
| request reviewers | `POST /repos/{owner}/{repo}/pulls/{number}/requested_reviewers` — `{ reviewers: ['login'] }` |

Create payload:

```json
{ "title": "…", "head": "feature-branch", "base": "main", "body": "…", "draft": false }
```

`head` is `branch` for same-repo PRs and `owner:branch` for cross-fork ones.
`base` must be an existing branch.

Merge payload:

```json
{ "merge_method": "merge" }
```

`merge_method`: `merge` (merge commit), `squash`, `rebase`.
Options: `commit_title`, `commit_message`, `sha` (only merge if head still is that
sha — use it to avoid merging an unreviewed push).

**Before merging**, `GET` the PR and check `mergeable` (`true`), `mergeable_state`
(`clean` is good; `blocked` = failing required checks or missing review;
`dirty` = conflicts), `draft` (must be `false`), and `head.sha`. Then tell the user
the PR number, title, checks state and target branch, and get a yes.

Response `200` with `merged: true` means it landed. `405` = not mergeable, `409` =
head sha moved (re-read).

## Reviewing

`POST /repos/{owner}/{repo}/pulls/{number}/reviews`:

```json
{ "event": "APPROVE" | "REQUEST_CHANGES" | "COMMENT", "body": "…",
  "comments": [{ "path": "src/a.ts", "line": 12, "body": "…" }] }
```

`REQUEST_CHANGES` without a `body` is rejected. Inline `line` must be a line that
appears in the diff (added or context), otherwise `422`.

Comment on the PR without a review verdict:
`POST /repos/{owner}/{repo}/issues/{number}/comments`.

## Checks and CI state on a PR

- `GET /repos/{owner}/{repo}/commits/{head_sha}/status` — combined commit status
- `GET /repos/{owner}/{repo}/commits/{head_sha}/check-runs` — check runs
  (`query: { per_page: 100 }`)

Summarise as "N passing, M failing, K pending" and name the failing check, rather
than pasting the whole list.
