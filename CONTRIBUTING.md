# Contributing

This repo uses a **branch-per-feature** workflow. There are no direct commits to `main`.

## Workflow

1. **Every feature or phase lands on its own branch**, named with the existing convention:
   - `feat/<slug>` — new functionality
   - `chore/<slug>` — pipeline, tooling, config, or maintenance work
   - `fix/<slug>` — bug fixes

2. **Merge to `main` only via a reviewed pull request**, gated on the `ci.yml` `test` check
   passing. Do not push directly to `main` and do not merge a PR whose `test` check is red.

3. Once a PR merges, `main` is always green (per (2)) and two things happen automatically —
   see [`release.yml`](.github/workflows/release.yml):
   - `ci.yml` has already run the full test suite (core + desktop) on the PR itself.
   - `release.yml` builds the Windows installer on `windows-2022` and publishes/refreshes a
     **rolling pre-release** (tag `latest-main`, "Latest build from main") with the `.exe`
     attached, so there is always one obvious download link for the newest build between
     formal version tags. Pushing a version tag (e.g. `v1.1.1`) still produces the normal,
     stable **versioned** GitHub Release, unaffected by the rolling pre-release.

## Branch protection (repo-admin action — run once, outside the codebase)

Merge-only-via-PR and the green-`test`-check requirement above are enforced by a GitHub
**repo settings** change, not by anything in this repository's code or workflows. It is a
one-time action that only a repo admin with an authenticated `gh` CLI can run — CI does not
run this, and no agent working in this repo can apply it without admin credentials:

```bash
gh api -X PUT repos/oongjiexiang/toastmasters-tools/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": ["test"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null
}
EOF
```

This requires the `ci.yml` `test` job to pass and at least one approving review before a PR
can merge into `main`. `enforce_admins` is deliberately `false`: this repo currently has a
single contributor, and a stricter setting (`enforce_admins: true`) would mean no PR — including
the repo owner's own — could ever be merged, since GitHub does not let an author approve their
own PR and there is no second account to review it. As an admin, the repo owner can still merge
past the review requirement when needed; the `test` status check still gates everyone.
