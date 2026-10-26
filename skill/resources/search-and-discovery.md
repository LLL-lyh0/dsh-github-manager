# Search and discovery

Search has its own quota (30 requests/minute authenticated, 1000 results max per
query) and returns `{ total_count, incomplete_results, items }`.

## Search endpoints

| Goal | Call | Useful query params |
|---|---|---|
| repositories | `GET /search/repositories` | `q`, `sort` (`stars`/`forks`/`updated`), `order`, `per_page` |
| code | `GET /search/code` | `q` (needs a repo/org/user qualifier) |
| issues and PRs | `GET /search/issues` | `q`, `sort`, `order` |
| commits | `GET /search/commits` | `q` |
| users | `GET /search/users` | `q` |
| topics | `GET /search/topics` | `q` |

Qualifier syntax inside `q`:

```
repo:owner/name            is:open  is:pr  is:issue  is:merged
user:login  org:name       label:bug  no:label  milestone:12
author:login  assignee:login  involves:login  review-requested:login
language:TypeScript  stars:>100  pushed:>2024-01-01  created:<2025-01-01
in:title  in:body  in:readme  in:description  path:src/  filename:*.md
```

Examples:

- My open PRs: `/search/issues?q=is:pr+is:open+author:me` (use the real login, not
  the literal `me`, except that `author:@me` does work on issues/PRs search).
- My repos matching a word: `/search/repositories?q=dsh+user:<login>`.
- Code inside one repo: `/search/code?q=addEventListener+repo:<owner>/<name>`.

`+` joins qualifiers; the tool URL-encodes for you, so write spaces or `+` in `q`
and let it handle the rest.

**Code search caveats.** Only the default branch is indexed, files above 384 KB
are skipped, and a `q` with no `repo:`/`org:`/`user:` qualifier may return `422`
depending on scope. When code search fails, fall back to
`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` and then read the
candidate file with the contents endpoint.

**Index lag.** A repo pushed seconds ago may not be searchable yet. That is not an
error — retry later or query the repo directly.

## Users and organisations

| Goal | Call |
|---|---|
| authenticated user | `GET /user` |
| any user | `GET /users/{login}` |
| my repos | `GET /user/repos` |
| my orgs | `GET /user/orgs` |
| org | `GET /orgs/{org}` |
| org members | `GET /orgs/{org}/members` |
| org teams | `GET /orgs/{org}/teams` |
| collaborators | `GET /repos/{owner}/{repo}/collaborators` |
| my permissions on a repo | include `permissions` — response of `GET /repos/{owner}/{repo}`, or `GET /repos/{owner}/{repo}/collaborators/{login}/permission` |

`GET /user` is the cheapest way to confirm the token works and to learn the login
and the granted `scopes` header. Use it when a user asks "which account am I on".
