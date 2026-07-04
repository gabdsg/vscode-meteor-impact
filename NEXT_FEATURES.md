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

## Ideas for future rounds

- **Linked editing / auto-rename of paired HTML tags** in spacebars files
  (`linkedEditingRangeProvider`, supported by vscode-html-languageservice).
- **Event selector intelligence**: jump from `"click .js-save"` to the
  elements matching `.js-save` in the template HTML, and completion of
  classes present in the template when typing an event key.
- **Signature help for helpers**: show the helper's parameters (from the
  JS/TS function signature) when typing `{{helper |}}`.
- **Package awareness**: index templates/helpers of local `packages/` and
  optionally installed Atmosphere packages, removing the "may be provided
  by a package" hedge from diagnostics.
- **Data context inference**: track `{{#each}}`/`{{#with}}` context types
  (from TS types on helpers) to offer property completions inside blocks.
- **Semantic tokens** for mustaches, so helpers/templates/globals get
  distinct colors.
