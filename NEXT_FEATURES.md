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
  prompts for the name, moves/copies the helpers and events the selection
  uses, and passes outer block variables as partial arguments)

## Ideas for future rounds

### Round C - bigger bets

- ~~Index persistence~~ (warm-start cache in the OS temp dir; unchanged
  projects skip re-parsing, JS/TS sources hydrate lazily)
- ~~Package awareness~~ (implemented via the local build bundles in
  `.meteor/local/build`: package templates/global helpers resolve in
  definitions, completion, hover and diagnostics, read-only)
- ~~Data context inference~~ - DECLINED: only pays off when code-behinds
  are TypeScript with annotated helper return types; this codebase's
  templates are mostly JS, so the checker would infer `any` everywhere.
  Revisit only if the app migrates its template code-behinds to typed TS.

### Housekeeping done

- CI (lint + coverage-gated tests + VS Code integration test + packaging,
  tag-triggered publishing to Marketplace and Open VSX - set the VSCE_PAT
  and OVSX_PAT repo secrets).
- Remaining nice-to-have: record the demo GIFs listed in docs/DEMOS.md
  for the marketplace page.
