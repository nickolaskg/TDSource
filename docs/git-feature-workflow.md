# Feature branch workflow

Use a new branch for every feature or milestone. Do not start feature work on
`main`.

## Start a feature

Open PowerShell in the `web` folder, then run:

```powershell
git status
git switch main
git pull --ff-only
git switch -c feature/short-description
```

`git status` should be clean before switching branches. Replace
`short-description` with a concise lowercase name such as `favorites-api` or
`review-workflow`.

## Save a checkpoint

```powershell
git status
git add .
git commit -m "Describe the completed checkpoint"
```

Commit only after the relevant checks pass. Avoid committing `.env`,
`.dev.vars`, credentials, build output, or unrelated files.

## Return to the feature later

```powershell
git switch feature/short-description
```

## Merge after validation

```powershell
git switch main
git pull --ff-only
git merge --no-ff feature/short-description
```

Do not merge until the feature is reviewed and the deployed checkpoint has been
tested. After a successful merge, the local feature branch can be removed with:

```powershell
git branch -d feature/short-description
```

If Git reports uncommitted changes, a conflict, or a non-fast-forward pull,
stop and inspect the message before continuing. Do not use `git reset --hard`
to solve it.
