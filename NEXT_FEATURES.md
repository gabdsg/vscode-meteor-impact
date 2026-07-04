# Next features to implement

The original WebStorm-parity roadmap is fully implemented:

1. ~~Context-aware Spacebars completion~~ (helpers/globals inside mustaches, templates after `{{>`)
2. ~~Find-references from HTML~~ (mustaches and partials, including definitions)
3. ~~`Meteor.call`/`callAsync`/`subscribe` name completion~~
4. ~~Hover~~ (helpers, templates, methods, publications, event keys)
5. ~~Document/workspace symbols~~ (outline, breadcrumbs, Ctrl+T)
6. ~~Project diagnostics~~ (unresolved partials/helper calls, duplicates, unused helpers)
7. ~~Rename refactoring~~ (helpers, templates, methods/publications, event keys; helper renames are scope-aware)
8. ~~Incremental reindexing~~ (per-file, follows unsaved buffers, 300ms debounce)
9. ~~Embedded HTML language service~~ (HTML completion/hover/folding + Emmet in spacebars files)
10. ~~Spacebars formatting~~ (document + range, mustache-block indentation)

Round A is implemented too:

- ~~Linked editing of paired HTML tags~~ (requires `editor.linkedEditing`)
- ~~Quick fixes~~ (create missing template/helper stubs, remove unused helpers)
- ~~Event selector intelligence~~ (event key -> element definition, class
  token -> handler references, selector completion in event keys)

## Ideas for future rounds

### Round B - "the editor understands Spacebars deeply"

- **Semantic tokens** for mustaches, so scoped helpers, global helpers,
  template partials, block keywords and unresolved names get distinct
  colors. The resolution logic already exists in the hover provider; the
  work is the LSP token encoding.
- **Block-variable awareness**: track `{{#each x in ...}}`, `{{#let}}` and
  `{{#with}}` scopes so completion offers the bound variables and semantic
  tokens/diagnostics treat them as resolved.
- **Signature help**: capture helper parameter lists at index time (slice
  the function signature by loc) and serve `{{helper |}}` plus
  `Meteor.call("x", |)` signature requests.

### Round C - bigger bets

- **Package awareness**: read `.meteor/versions` and index the .html/.js
  sources of installed packages from `~/.meteor/packages` read-only, so
  package templates (e.g. `loginButtons`) get go-to-definition and stop
  needing the "may be provided by a package" hedge in diagnostics.
- **Extract template refactor**: code action that moves the selected HTML
  into a new `<template>`, replaces it with `{{> name}}` and optionally
  stubs the code-behind.
- **Data context inference** (full version): run the TypeScript checker
  against code-behind files to know helper return types and offer property
  completions inside `{{#each}}`/`{{#with}}` blocks. Consider building it
  into `typescript-meteor-toolbox-plugin` instead of the language server.
