# Repositories, branches, files, commits, releases

## Repositories

| Goal | Call |
|---|---|
| list mine (owned + collaborator + org) | `GET /user/repos` — `query: { per_page: 100, sort: 'updated', affiliation: 'owner,collaborator,organization_member' }` |
| list an org's | `GET /orgs/{org}/repos` |
| list a user's public | `GET /users/{user}/repos` |
| one repo | `GET /repos/{owner}/{repo}` |
| create for me | `POST /user/repos` — `body: { name, description, private: true, auto_init: true }` |
| create in an org | `POST /orgs/{org}/repos` |
| edit | `PATCH /repos/{owner}/{repo}` — `{ description, private, archived, default_branch, has_issues, has_wiki }` |
| delete | `DELETE /repos/{owner}/{repo}` — **irreversible, confirm first** |
| topics | `PUT /repos/{owner}/{repo}/topics` — `body: { names: ['a','b'] }` |

`auto_init: true` matters: creating a repo without it leaves it empty, with no
default branch, and every file/branch call then fails.

Useful fields in the response: `full_name`, `private`, `archived`, `disabled`,
`default_branch`, `html_url`, `pushed_at`, `updated_at`, `stargazers_count`,
`open_issues_count`, `permissions` (`push`/`admin` tell you what the token may do).

## Branches

| Goal | Call |
|---|---|
| list | `GET /repos/{owner}/{repo}/branches` — `query: { per_page: 100 }` |
| one (gives head `sha`) | `GET /repos/{owner}/{repo}/branches/{branch}` |
| create | `POST /repos/{owner}/{repo}/git/refs` — `body: { ref: 'refs/heads/feature', sha: '<commit sha>' }` |
| delete | `DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}` |

Branch protection: `GET|PUT|DELETE /repos/{owner}/{repo}/branches/{branch}/protection`.
Putting it in place needs admin on the repo.

## File contents

| Goal | Call |
|---|---|
| read | `GET /repos/{owner}/{repo}/contents/{path}` — `query: { ref: 'branch' }` |
| list a directory | same call with the directory path |
| create/update | `PUT /repos/{owner}/{repo}/contents/{path}` |
| delete | `DELETE /repos/{owner}/{repo}/contents/{path}` |

Content is base64 in `content` with whitespace/newlines in it — decode with the
whitespace stripped. Read the file **first** to obtain its `sha`; an update without
the current `sha` returns `409`/`422`.

Update payload:

```json
{ "message": "commit message", "content": "<base64>", "sha": "<current blob sha>", "branch": "main" }
```

Create payload is the same minus `sha`. `DELETE` needs `{ message, sha, branch }`.
Files above ~1 MB must go through the Git Data API (blobs/trees/commits) instead.

## Commits and Git data

| Goal | Call |
|---|---|
| list commits | `GET /repos/{owner}/{repo}/commits` — `query: { per_page: 30, sha: 'branch' }` |
| one commit + diff files | `GET /repos/{owner}/{repo}/commits/{sha}` |
| compare two refs | `GET /repos/{owner}/{repo}/compare/{base}...{head}` |
| create blob | `POST /repos/{owner}/{repo}/git/blobs` — `{ content, encoding: 'utf-8'|'base64' }` |
| create tree | `POST /repos/{owner}/{repo}/git/trees` — `{ base_tree, tree: [{ path, mode:'100644', type:'blob', sha }] }` |
| create commit | `POST /repos/{owner}/{repo}/git/commits` — `{ message, tree, parents: [headSha] }` |
| move a ref | `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}` — `{ sha, force: false }` |

Multi-file commit = blob(s) → tree → commit → move the ref. Four calls in that
order; skipping the ref update leaves an unreachable commit.

Merge a branch into another: `POST /repos/{owner}/{repo}/merges` —
`body: { base: 'main', head: 'feature', commit_message: '…' }`. A `204` means the
base was already up to date.

## Releases and tags

| Goal | Call |
|---|---|
| list | `GET /repos/{owner}/{repo}/releases` |
| latest | `GET /repos/{owner}/{repo}/releases/latest` |
| create | `POST /repos/{owner}/{repo}/releases` |
| edit | `PATCH /repos/{owner}/{repo}/releases/{id}` |
| delete | `DELETE /repos/{owner}/{repo}/releases/{id}` |

Create payload:

```json
{ "tag_name": "v1.2.0", "target_commitish": "main", "name": "v1.2.0",
  "body": "changelog", "draft": false, "prerelease": false }
```

A tag that does not exist yet is created at `target_commitish`. List tags with
`GET /repos/{owner}/{repo}/tags`; a lightweight tag ref also lives under
`git/refs/tags/{tag}`.

## Rename / transfer

- Rename: `PATCH /repos/{owner}/{repo}` with `{ name: 'new-name' }` — redirects
  are left behind, but existing clones need a re-point.
- Transfer: `POST /repos/{owner}/{repo}/transfer` with `{ new_owner, team_ids }`.
  **Both are user-visible and hard to walk back — confirm first.**
