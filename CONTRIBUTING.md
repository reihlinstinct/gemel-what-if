# Contributing

- One issue per change, one branch and PR per issue; squash-merge with a full description (what, why, tests, limits).
- Run `npm test` before opening a PR; CI runs the same.
- Code and docs in English, UI text in Hebrew.
- Never commit real personal stories or balances. Examples must be fictional.

## File placement (enforced)

Decide where a file lives BEFORE creating it. The contract in `.repo-layout.yml` lists the allowed top-level directories, the file types permitted in each, and the required community-standards files; `python3 tools/check_repo_layout.py` enforces it in CI. A new kind of file means updating the contract in the same PR.
