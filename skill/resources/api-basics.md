# API basics

Applies to every `github_api` call.

## Request shape

`github_api` already does the plumbing: it builds
`https://api.github.com` + `path`, adds `Authorization: Bearer <token>`,
`Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` and a
`User-Agent`. You never pass headers.

- `path` starts with `/`. Absolute URLs are accepted but do not add the API base
  twice.
- `query` values are stringified; `undefined` / `null` / `''` are dropped, so a
  conditional parameter is `query: { state: mine ? 'open' : undefined }`.
- `body` is JSON-encoded automatically. Do not pass a pre-stringified JSON string
  unless you mean to.

## Pagination

GitHub defaults to 30 items per page, max 100.

- Always pass `per_page` when listing: `query: { per_page: 100 }`.
- Read `body.length`. A full page means **there may be more**; fetch the next one
  with `query: { per_page: 100, page: 2 }`.
- Do not loop "until empty" over thousands of items — stop at what the user asked
  for and say how far you got.
- Search endpoints (`/search/*`) cap at 1000 results total and use
  `items` in the body instead of a bare array.

## Rate limits

Every response carries rate data. `github_api` surfaces it as `rate`:
`{ limit, remaining, reset, used }` where `reset` is a Unix timestamp in seconds.

- Authenticated REST allows 5000 requests/hour. Search is 30/minute
  (authenticated). GraphQL is 5000 points/hour.
- If `remaining` is low, say so before continuing a long loop.
- `reset` is absolute time — compute the wait from it rather than guessing.

## Conditional requests (cheap polling)

Send `If-None-Match` with a previously seen `ETag` and a `304` answer does **not**
consume quota; the body is empty. Useful when re-reading the same resource in a
loop. `github_api` passes no extra headers, so use this only if the user is
polling hard enough that quota matters — otherwise just re-read.

## Errors

`ok:false` returns `{ code, status, error }` where `error` is GitHub's
`message` field. `body.errors[]` (when present) has field-level detail.

| status | usual cause |
|---|---|
| 400 | malformed path or query |
| 401 | token invalid/expired — ask the user to re-add it |
| 403 | missing scope, or rate limited (check `rate.remaining`) |
| 404 | wrong path **or** no access to a private resource |
| 409 | conflict — branch/empty repo state |
| 422 | validation failed — see `body.errors` |
| 429 | secondary rate limit — back off |

## Things that bite

- **`{owner}/{repo}`** must both be literal. Get them from a real response, not
  from the account login.
- **Timestamps** are ISO-8601 UTC. Report them as-is or convert, but say which.
- **Empty repository**: no default branch, so file and branch endpoints 404/409
  until something is pushed.
- **Case**: repository names are case-insensitive in the URL but the API returns
  the canonical `full_name` — use that in links.
- **Private repo 404** is indistinguishable from nonexistent. Do not conclude the
  repo "does not exist"; check `/user/repos` or the org first.
