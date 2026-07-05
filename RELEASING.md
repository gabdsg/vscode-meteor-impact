# Releasing Meteor Impact

Publishing is fully automated: a lowercase `v*` tag on a green commit
publishes to the VS Code Marketplace and Open VSX. This is the checklist.

## 1. Prepare the release

1. Update `CHANGELOG.md`: add a `## [X.Y.Z] - YYYY-MM-DD` section at the
   top describing what changed. The marketplace shows this file in the
   listing's Changelog tab.
2. Bump the version in `package.json` (keep `package-lock.json` in sync):

    ```bash
    npm version X.Y.Z --no-git-tag-version
    ```

3. Commit and push to `main`:

    ```bash
    git add package.json package-lock.json CHANGELOG.md
    git commit -m "Release X.Y.Z"
    git push origin main
    ```

4. Wait for the CI run on `main` to go green (lint, unit tests with the
   coverage gate, vsce package, VS Code integration test).

## 2. Tag it

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

**The tag must start with a lowercase `v`** (`v2.0.1`, not `V2.0.1`).
The workflow triggers on `tags: ["v*"]` and GitHub tag filters are
case-sensitive - an uppercase tag will sit there and never publish.

Alternatively, create the tag from the GitHub UI: Releases -> "Draft a
new release" -> type `vX.Y.Z` -> "Create new tag on publish" -> target
`main` -> paste the changelog section as the description -> Publish.
This also gives you a GitHub Release for free.

## 3. What CI does on the tag

The `publish` job in `.github/workflows/ci.yml` runs only for `v*` tags,
after the test and integration jobs pass:

1. `npx @vscode/vsce publish -p $VSCE_PAT` -> VS Code Marketplace
   (`gabdsg.meteor-impact`).
2. `npx ovsx publish -p $OVSX_PAT` -> Open VSX (VSCodium, Cursor,
   Gitpod). This step is `continue-on-error`, so a missing/expired Open
   VSX token never blocks the Marketplace release.

The version published is whatever is in `package.json` - the tag name
only triggers the workflow, so keep them matching.

## 4. Verify

-   Watch the Actions run for the tag; the "Publish to marketplaces" job
    should be green (check both steps - the Open VSX one can fail quietly
    because of `continue-on-error`).
-   Marketplace: <https://marketplace.visualstudio.com/items?itemName=gabdsg.meteor-impact>
    (validation can take a few minutes after the job finishes).
-   Open VSX: <https://open-vsx.org/extension/gabdsg/meteor-impact>

## Secrets

Both live in the GitHub repo: Settings -> Secrets and variables ->
Actions.

-   `VSCE_PAT`: Azure DevOps personal access token (created at
    `https://dev.azure.com` / `aex.dev.azure.com`) with **Organization:
    All accessible organizations** and the **Marketplace -> Manage**
    scope. These expire (max 1 year) - when publishing fails with a 401,
    regenerate the PAT and update the secret.
-   `OVSX_PAT`: access token from your <https://open-vsx.org> profile
    settings (namespace `gabdsg`). Optional but nice for
    VSCodium/Cursor users.

## Manual fallback

If CI is unavailable, you can publish from any machine:

```bash
npm ci
npx @vscode/vsce publish -p <VSCE_PAT>
npx ovsx publish -p <OVSX_PAT>
```

Or build the `.vsix` (`npx @vscode/vsce package`) and upload it by hand
at <https://marketplace.visualstudio.com/manage/publishers/gabdsg>.
