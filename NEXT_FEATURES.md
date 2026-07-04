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

Rounds A and B are implemented too:

- ~~Linked editing of paired HTML tags~~ (requires `editor.linkedEditing`)
- ~~Quick fixes~~ (create missing template/helper stubs, remove unused helpers)
- ~~Event selector intelligence~~ (event key -> element definition, class
  token -> handler references, selector completion in event keys)
- ~~Block-variable awareness~~ (`{{#each x in ...}}`/`{{#let}}` bindings in
  completion and diagnostics)
- ~~Semantic tokens~~ (resolved helpers/templates/keywords/block variables
  get semantic colors; unresolved paths keep the grammar color)
- ~~Signature help~~ (`{{helper |}}` and `Meteor.call("x", |)`, with TS
  parameter annotations preserved)
- ~~Extract template refactor~~ (selection -> new `<template>` + `{{> partial}}`;
  rename the generated placeholder name with F2)

## Ideas for future rounds

### Round C - bigger bets

- **Package awareness**: read `.meteor/versions` and index the .html/.js
  sources of installed packages from `~/.meteor/packages` read-only, so
  package templates (e.g. `loginButtons`) get go-to-definition and stop
  needing the "may be provided by a package" hedge in diagnostics.
- **Data context inference** (full version): run the TypeScript checker
  against code-behind files to know helper return types and offer property
  completions inside `{{#each}}`/`{{#with}}` blocks. Consider building it
  into `typescript-meteor-toolbox-plugin` instead of the language server.
