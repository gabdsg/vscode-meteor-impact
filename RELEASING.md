# Releasing Meteor Impact

Publishing is fully automated: a lowercase `v*` tag on a green commit
publishes to the VS Code Marketplace and Open VSX. This is the checklist.

## 1. Prepare the release

1. Verify the build you are about to ship:

    ```bash
    npm run test:server
    npm run test:client
    ```

    Then dogfood in the Extension Development Host (F5). The server
    logs `* Meteor Impact language server X.Y.Z` as its first output
    line - **if the banner is missing or shows an old version, you are
    testing a stale build**, not your working tree. Relaunch the dev
    host after any server change; a host started earlier keeps running
    the old code.
2. Update `CHANGELOG.md`: rename the `## [Unreleased]` section to
   `## [X.Y.Z] - YYYY-MM-DD` (between releases, changes accumulate
   under `[Unreleased]`). The marketplace shows this file in the
   listing's Changelog tab.
3. Bump the version in `package.json` (keep `package-lock.json` in sync):

    ```bash
    npm version X.Y.Z --no-git-tag-version
    ```

4. Commit and push to `main`:

    ```bash
    git add package.json package-lock.json CHANGELOG.md
    git commit -m "Release X.Y.Z"
    git push origin main
    ```

5. Wait for the CI run on `main` to go green (lint, unit tests with the
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
-   If the Marketplace step dies with `Request timeout: /_apis/gallery`
    exactly 3 minutes after "Publishing ...", the GitHub runner cannot
    reach the gallery API (v2.1.4, 2026-09-08: 5 identical failures over
    50 minutes while the same endpoint answered a laptop instantly).
    Nothing gets published on a timeout. Retry with
    `gh run rerun <run-id> --failed` (free: the repo is public). On
    v2.1.4 five retries within an hour all failed and the sixth, two
    hours later, published in 3 seconds - so either wait an hour or two
    and retry, or use the manual fallback below with the CI-built
    `.vsix` if it has to go out now.
    `npx @vscode/vsce show gabdsg.meteor-impact --json` shows the live
    version.
-   Marketplace: <https://marketplace.visualstudio.com/items?itemName=gabdsg.meteor-impact>
    (validation can take a few minutes after the job finishes).
-   Open VSX: <https://open-vsx.org/extension/gabdsg/meteor-impact>
-   Update the installed extension (`code --list-extensions
    --show-versions | grep meteor-impact`) and open a Meteor project:
    the Output panel ("Meteor Impact Language Server") must start with
    the new version banner. Until the update lands, the old installed
    build keeps running with its old bugs - don't dogfood fixes there.

## Secrets

Both live in the GitHub repo: Settings -> Secrets and variables ->
Actions.

-   `VSCE_PAT`: Azure DevOps personal access token (created at
    `https://dev.azure.com` / `aex.dev.azure.com`) with **Organization:
    All accessible organizations** and the **Marketplace -> Manage**
    scope. These expire (max 1 year) - when publishing fails with a 401,
    regenerate the PAT and update the secret.
-   `OVSX_PAT`: access token from your <https://open-vsx.org> profile
    settings. Optional but nice for VSCodium/Cursor users. **The
    `gabdsg` namespace must be created once before the first publish**
    (`npx ovsx create-namespace gabdsg -p <OVSX_PAT>`); until then every
    Open VSX step fails with `Unknown publisher: gabdsg` while the run
    still shows green because of `continue-on-error`. As of 2026-09-08
    the namespace does not exist and no version has ever reached Open
    VSX.

## Manual fallback

If CI cannot publish, ship the exact `.vsix` the tag's CI run built and
integration-tested (the `vsix` artifact of the "Lint, unit tests &
package" job) from any machine:

```bash
gh run download <run-id> -n vsix        # -> meteor-impact-X.Y.Z.vsix
npx @vscode/vsce publish --packagePath meteor-impact-X.Y.Z.vsix -p <VSCE_PAT>
npx ovsx publish --packagePath meteor-impact-X.Y.Z.vsix -p <OVSX_PAT>
```

`*.vsix` is gitignored, so the file can sit at the repo root. Building
locally instead (`npm ci && npx @vscode/vsce publish -p <VSCE_PAT>`) also
works, as does uploading the `.vsix` by hand at
<https://marketplace.visualstudio.com/manage/publishers/gabdsg>.
