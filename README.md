![Meteor Impact](images/banner.png)

[![CI](https://github.com/gabdsg/vscode-meteor-impact/actions/workflows/ci.yml/badge.svg)](https://github.com/gabdsg/vscode-meteor-impact/actions/workflows/ci.yml)

# Meteor Impact

Full-impact language tooling for Meteor and Blaze. Meteor Impact turns VS Code
into a first-class Meteor IDE: TypeScript-aware indexing, rich Spacebars
intelligence, refactorings, diagnostics with quick fixes and template
scaffolding - plus intellisense for Meteor core and Atmosphere packages and
ready-made run/debug configurations.

Meteor Impact started as a fork of
[Meteor Toolbox](https://github.com/matheusccastroo/vscode-meteor-toolbox) by
Matheus and Renan Castro, and greatly extends its language server.

## Usage

Just install the extension in a Meteor project and it will add the needed
configuration for you.

Note: this extension changes the `jsconfig.json` and `.vscode/launch.json`.
Remember to not include those changes to your version control system, as they
are scoped to your environment.

## Language features

Works in `.js`, `.ts` and Spacebars `.html` files:

-   **Completions**: template-scoped and global helpers inside mustaches,
    template names after `{{>`, block variables (`{{#each x in ...}}`,
    `{{#let}}`), `Meteor.call`/`callAsync`/`subscribe` names, event selector
    classes/ids, CSS classes/ids from same-directory style files inside
    `class="..."`/`id="..."`, plus full HTML completion and Emmet in
    templates.
-   **Go to definition / references**: helpers, templates, methods,
    publications, event handlers (including event key -> targeted HTML
    element and class token -> event handlers), from both HTML and JS/TS.
-   **Rename (F2)**: helpers (scope-aware), templates (tags, partials and
    `Template.X` references), methods/publications and event keys.
-   **Diagnostics with quick fixes**: unresolved partials and helper calls
    (create the missing stub in one click), duplicate template names, unused
    helpers (with safe removal).
-   **Refactorings**: "Extract selection to template" moves the selected
    HTML into a new template together with the helpers/events it uses and
    passes outer block variables as partial arguments.
-   **Semantic highlighting**: resolved helpers, templates, block keywords
    and block variables get distinct colors.
-   **Hover, signature help, outline/breadcrumbs, workspace symbol search,
    folding, linked tag editing and Spacebars formatting** (with mustache
    block indentation). Helper hovers include the JSDoc written above the
    definition.
-   **Closing-tag hints**: long blocks show their opening condition as a
    ghost hint at `{{/if}}`/`{{else}}` (`« if isSavingState`). Long HTML
    elements can also show their id/classes at the closing tag
    (`« .toolbar`) - opt-in via the `htmlClosingTagHints` setting.
-   **Method/publication safety**: calls to unknown methods or
    subscriptions to unknown publications are flagged, with quick fixes to
    create the stub; unused methods/publications are hinted.
-   **Template scaffolding**: right-click a folder -> `Create Blaze
    Template` generates the folder with the `.html`, `.js`/`.ts` (imports and
    `onCreated`/`helpers`/`events` stubs) and optional `.less`/`.css` files;
    `Rename Blaze Template` renames the folder, files, imports and every
    usage together.
-   **Snippets**: Blaze block snippets (usable with "Surround With") and
    Meteor lifecycle/method/publication snippets in JS/TS.
-   **.meteor/packages intelligence**: hover shows the resolved version,
    completion offers installed packages.
-   **Package awareness**: templates and global helpers provided by
    installed packages (e.g. `{{> loginButtons}}`) resolve in definitions,
    completion, hover and diagnostics.
-   **Meteor Explorer**: an activity bar panel with an app-wide overview
    (templates/helpers/events/methods/publications, with unused markers)
    and the template inclusion hierarchy - it follows the active editor,
    and has a search filter plus a current-file scope toggle.
-   **Block auto-close**: typing `{{#if ...}}` (or pressing Enter after
    it) inserts the matching `{{/if}}`; block regions fold.
-   **Inlay hints**: helper call arguments show their parameter name
    inline.
-   **Instant warm starts**: the index is cached, so an unchanged project
    skips re-parsing on startup; parse errors show as in-file squiggles.

The index follows unsaved edits incrementally, so results stay fresh while
you type.

## Available commands

`Create Blaze Template` -> Scaffold a new template folder (also in the
explorer context menu).

`Rename Blaze Template` -> Rename a template folder, its files and every
usage (also in the explorer context menu).

`Go to Template Counterpart` (Alt+O) -> Cycle between a template's .html,
code-behind and style files.

`Nest Template Files Under Code-Behind` -> Explorer file nesting for
template folders (writes workspace settings).

`Generate Meteor.settings Types` -> Generate meteor-settings.d.ts from
settings.json for typed Meteor.settings access.

`Toggle Meteor Impact Auto Run` -> Toggle file watcher for packages folders.

`Run Meteor Impact set up manually` -> Run the extension manually, only one
time (if autorun is not enabled).

`Run clear meteor build cache` -> Clear meteor build cache.

`Re-create Meteor Impact run/debug options` -> Re-create `launch.json` file.
Usefull when you change the port settings.

## Requirements

This extension only runs inside a Meteor project.

## Extension Settings

See [SETTINGS.md](./SETTINGS.md) for the full settings reference,
including the editor settings that unlock format-on-save, linked tag
editing, string completions and semantic colors.

-   `auto` -> Enable the file watcher for local packages. You can also set this option by running the command `Toggle Meteor Impact Auto Run` (it is enabled by default).

-   `port` -> Set the port to use for meteor run/debug. Default to 3000.

-   `additionalArgs` -> Set additional args to meteor run/debug configuration. Re-create the run options when changing this setting.

-   `meteorPackageDirs` -> Use a custom packages diretory.

-   `ignoreDirsOnIndexing` -> List of directories to ignore when the Meteor Language Server is indexing the project.

-   `closingTagHints` -> Show ghost hints with the opening condition after the `{{/block}}` and `{{else}}` of long Blaze blocks. Enabled by default.

-   `htmlClosingTagHints` -> Show ghost hints with the id/classes after the closing tag of long HTML elements (`</div>` gets `« .toolbar`). Disabled by default.

## Credits

Based on [Meteor Toolbox](https://github.com/matheusccastroo/vscode-meteor-toolbox)
by [Matheus Castro](https://github.com/matheusccastroo) and
[Renan Castro](https://github.com/renanccastro). The packages watcher is
inspired on
[meteor-package-intellisense](https://github.com/mattblackdev/meteor-package-intellisense).
