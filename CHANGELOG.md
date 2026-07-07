# Change Log

All notable changes to the "Meteor Impact" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [2.0.6] - 2026-07-07

### Fixed

-   **Hover and go-to-definition requests failed with a parse error on
    files the Meteor build accepts**, e.g. a stray brace right after a
    mustache (`id="btn-{{cardId}}}"`). The indexer already tolerated
    these; now every request provider shares the same lenient parse:
    HTML comments are ignored like Meteor does, and a file the mustache
    parser rejects degrades gracefully (hover falls back to the
    built-in HTML tag docs) instead of failing the request. This also
    un-breaks rename, references, semantic colors and closing-tag hints
    in files with a commented-out mustache.
-   **Go-to-definition on a template inclusion crashed with
    `htmlJs.find is not a function`** in files with exactly one
    top-level tag (the Spacebars compiler returns a single node instead
    of an array for those).

## [2.0.5]

-   The activity bar icon is a monochrome flame over impact ripples
    instead of a solid circle (the old color PNG's opaque disc was
    swallowed whole by VS Code's icon masking).

## [2.0.4]

-   **Inclusion arguments resolve as data**: after `{{> item title="hello"}}`,
    `{{title}}` inside `item` is no longer an unknown name - it completes
    ("Data passed by callers"), hovers with the passing inclusion site,
    go-to-definition jumps to every caller that passes it, it colors like
    a bound variable, and calls like `{{formatter x}}` where `formatter`
    is passed by a caller are not flagged as unresolved helpers.

## [2.0.3]

-   Closing-tag hints are now two independent settings:
    `closingTagHints` keeps the Blaze block hints (`« if isSavingState`
    at `{{/block}}`/`{{else}}`, on by default), and the HTML element
    hints (`« .toolbar` at `</div>`) moved to `htmlClosingTagHints`,
    **off by default**.

## [2.0.2] - 2026-07-06

Second dogfooding round: a file-corrupting formatter bug and new
template-editing comforts. **Update as soon as possible**: 2.0.1 and
older can mangle a file when formatting with unsaved changes.

### Fixed

-   **The language server read stale disk content instead of the open
    buffer**: `TextDocuments.get` is keyed by the URI string but was
    called with a URI object, so every provider silently worked from the
    last saved file. Worst case was formatting: edits computed against
    stale disk text were applied to the live buffer, splicing duplicated
    fragments into the document and losing the unsaved changes
    (real-world file corruption).
-   Formatting refuses to produce edits when the document has no synced
    buffer, so format edits can never again be computed from disk
    content.
-   Formatting skips Blaze files that don't parse (e.g. a stray
    `</template>`), keeping the parse error visible instead of
    re-indenting broken markup. Non-Blaze HTML pages still format.
-   Fix an indexing error on `Template.hasOwnProperty(...)` and other
    `Object.prototype` method calls on `Template` (seen in
    `aldeed:template-extension`): the property name was mistaken for a
    template reference and the inherited function crashed the scan of
    that file.

### Added

-   **Closing-tag hints**: long `{{#block}}`s show their opening condition
    as a ghost hint at `{{/block}}` and `{{else}}` (`« if isSavingState`),
    and long HTML elements show their id/classes at the closing tag
    (`« .toolbar`). Toggle with the `closingTagHints` setting.
-   **CSS class/id completion**: inside `class="..."` / `id="..."`,
    selectors from same-directory `.css`/`.less`/`.scss` files are
    offered.
-   **JSDoc in hovers**: the `/** ... */` block above a template or
    global helper definition now shows in its hover card.
-   The language server logs its version on startup
    (`* Meteor Impact language server 2.0.2`), so stale-build sessions
    are easy to spot.

## [2.0.1] - 2026-07-06

Hardening from the first large-app dogfooding run.

-   **Fix a fatal crash on startup**: mustaches with no name to index
    (`{{this}}`, `{{.}}`, literals, sub-expression params) made the
    indexer throw during the initial scan, which killed the language
    server before it could start.
-   Full-page HTML files (doctype email templates, generated reports)
    are recognized as non-Blaze and skipped quietly instead of being
    reported as parse errors.
-   Files that Meteor's Spacebars accepts but the stricter mustache
    parser doesn't (commented-out block tags, a stray brace after a
    mustache) no longer get false-positive error squiggles: HTML
    comments are ignored like Meteor does, and remaining cases degrade
    gracefully instead of erroring.
-   `node_modules` anywhere in the tree (e.g. `playwright/node_modules`)
    is now excluded from indexing.
-   One broken file can no longer abort the project scan: indexing
    failures are contained per file.

## [2.0.0] - 2026-07-05

First release as **Meteor Impact** (`gabdsg.meteor-impact`), forked from
[Meteor Toolbox](https://github.com/matheusccastroo/vscode-meteor-toolbox).

**BREAKING**: all identifiers changed - commands are now `meteorImpact.*`
and the settings key is `conf.settingsEditor.meteorImpact` (update your
settings.json/keybindings), the diagnostics source is `meteor-impact` and
the TS server plugin is `typescript-meteor-impact-plugin`.

### TypeScript support

-   Add TypeScript support to the language server indexer: `.js` and `.ts`
    files are now parsed with `@babel/parser` (estree-compatible AST), so
    `.ts` files no longer drop out of the index, and definition/references/
    completion also work from `.ts` files.
-   Register TypeScript documents with the language client.
-   Signature help preserves TypeScript parameter annotations.

### Indexing

-   Index `Template.registerHelper` calls as global helpers, with
    definition fallback when a mustache doesn't match a template-scoped
    helper.
-   Index every `<template>` tag of an HTML content chunk with its precise
    location (previously only the first one per chunk was indexed).
-   Support `Template["kebab-name"]` computed member access and string
    literal helper keys when indexing helpers.
-   Index `Template.X.events` maps and support find-references on event
    handler keys.
-   Reindex changed files incrementally (following unsaved edits) instead
    of reindexing the whole project on every change.
-   Cache the index for instant warm starts on unchanged projects.
-   Make project indexing deterministic regardless of file read order.
-   Resolve templates/global helpers provided by installed packages
    (scanned from the local build) in definitions, completion, hover and
    diagnostics; stop indexing `.meteor/**` as app sources.

### Language features

-   Context-aware completions in Spacebars templates: helpers of the
    wrapping template and global helpers inside `{{...}}`, template names
    after `{{>`, block variables, and method/publication names inside
    `Meteor.call`/`callAsync`/`subscribe` string arguments.
-   Find-references from HTML files (mustaches and partials), including
    definitions.
-   Hover cards for helpers, templates, methods, publications and event
    keys.
-   Outline/breadcrumbs (document symbols) and workspace symbol search for
    templates, helpers, events, methods and publications.
-   Rename refactoring for helpers, templates, methods/publications and
    event keys, updating definitions and usages together. Helper renames
    are scope-aware: only the resolved template scope (or the global
    helper, excluding shadowed usages) is renamed. Templates can also be
    renamed from their own tag attribute.
-   Signature help for `{{helper args}}` mustaches and
    `Meteor.call`/`callAsync`/`subscribe` argument lists.
-   Parameter-name inlay hints in helper calls (LSP upgraded to 3.17).
-   Semantic highlighting for Spacebars: resolved helpers, templates,
    block keywords and block variables get distinct colors.
-   Track `{{#each x in ...}}`/`{{#let}}` block variables: offered in
    completion, excluded from unresolved-helper diagnostics.
-   Connect event maps with template HTML: go-to-definition from event
    keys to targeted elements, find handlers from class/id tokens, and
    selector completion inside event keys.
-   Embed the HTML language service: HTML completion, hover, folding
    ranges and Emmet now work in Spacebars files alongside the Blaze
    features.
-   Linked editing of paired HTML tags and folding of `{{#block}}` regions
    in Spacebars files.
-   Document and range formatting for Spacebars files, with mustache block
    indentation.
-   Auto-close Blaze block tags (`{{#if ...}}` inserts `{{/if}}`).

### Diagnostics and quick fixes

-   Publish project diagnostics: unresolved partials, unresolved helper
    calls with arguments, duplicate template names and unused helpers.
-   Flag calls to unknown methods/publications with create-stub quick
    fixes, and hint unused ones.
-   Quick fixes: create missing template/helper stubs, remove unused
    helpers.
-   Parse errors appear as in-file error squiggles instead of a
    notification popup.

### Refactoring

-   "Extract selection to template": prompts for the template name, moves
    the selected HTML into a new template, replaces it with a partial
    (passing outer block variables as arguments), and moves or copies the
    helpers and events the selection uses.

### Workflow tooling

-   "Create Blaze Template" explorer context menu: scaffolds a folder with
    the template HTML, a .js or .ts code-behind (asked via prompt,
    importing the HTML/style and stubbing onCreated/helpers/events) and
    optionally a .less/.css file (less when the meteor less package is
    installed).
-   "Rename Blaze Template": renames the folder, files, imports and all
    usages together.
-   "Go to Template Counterpart" (Alt+O) cycling html -> code-behind ->
    style.
-   Explorer file nesting for template files, Blaze/Meteor snippets
    (Surround With support), `.meteor/packages` hover/completion, and
    "Generate Meteor.settings Types".
-   Meteor Explorer activity bar panel: app-wide overview and template
    inclusion hierarchy with click-to-jump and unused markers; reveals the
    active file's template on editor switch, and has a current-file scope
    toggle and a search filter (prunes both trees, keeping hierarchy paths
    that lead to matches).
-   Status bar shows indexing progress and index stats.
-   Skip `jsconfig.json` generation when the workspace has a
    `tsconfig.json`.

### Fixes and infrastructure

-   Fix method/publication usages not being indexed when the defining file
    sorted after the using file.
-   Fix crash when resolving helpers of a template that has none indexed.
-   Add GitHub Actions CI (lint, coverage-gated unit tests, VS Code
    integration test, packaged .vsix artifact, tag-triggered marketplace +
    Open VSX publishing).

## [07/01/23]

-   Fix issue where methods declared as an object property were not being properly indexed.
-   Fix issue where references were not being correctly processed on `typescript-server-plugin`.

## [02/01/23]

-   Add support for Meteor methods and publications jump to definition and references.
-   Add support for `ValidatedMethod` and `PublishComposite` packages.
-   Use the correct request when handling references.
-   Create `typescript-meteor-toolbox-plugin` to fix some conflicts between our LS and the TypeScript/JavaScript LS.

## [24/11/22]

-   Add option to ignore directories for indexing on the extension settings.

## [09/11/22]

-   Create Meteor Language Server
-   Add support for Blaze and Spacebars

## [06/09/22]

-   Fix issue with custom packages (#4)

## [19/05/22]

-   Add JSX support
-   Add additional arguments options to `launch.json`.

## [10/05/22]

-   Initial release
