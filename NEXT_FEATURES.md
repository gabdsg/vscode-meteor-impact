# Next features to implement

Roadmap of WebStorm-parity features for the language server. Items 1-6 of the
original list (context-aware Spacebars completion, find-references from HTML,
`Meteor.call`/`subscribe` name completion, hover, document/workspace symbols
and project diagnostics) are already implemented.

## 7. Rename refactoring

Rename a helper or template and update every usage together: `{{usages}}`,
`{{> partials}}`, block parameters and the JS/TS definition.

Implementation notes:

- Implement `textDocument/prepareRename` (validate that the symbol at the
  position is a helper/template/event key we track) and `textDocument/rename`
  returning a `WorkspaceEdit`.
- All edit locations are already available: `htmlUsageMap` for HTML usages,
  `templateIndexMap[..].helpers` / `globalHelpersMap` for definitions (helper
  index entries carry precise `start`/`end` and `uri`).
- Template rename needs edits in the `<template name="...">` attribute: reuse
  `getTemplateTags()` from `text-utils.js` to compute the attribute range.
- Watch out: helper keys can be string literals (`"my-helper": fn`) and
  template access can be computed (`Template["my-template"]`) - the
  replacement range must not include the quotes.
- Capability: `renameProvider: { prepareProvider: true }`.

## 8. Incremental reindexing

The server currently re-globs and re-parses the entire project on every
change (3s debounce), so results are stale after each edit and indexing cost
grows with project size.

Implementation notes:

- On `onDidChangeContent`/`onDidChangeWatchedFiles`, reindex only the changed
  file: drop the map entries whose `uri` matches, re-parse that file, and
  re-run the per-file indexers.
- Requires making the blaze/methods indexers able to remove entries per uri
  (each entry already stores its `uri`; `htmlUsageMap`/`eventsMap` entries
  carry an `entryKey` prefixed by the fsPath).
- Keep the full reindex for configuration changes (ignored dirs) and as a
  fallback; drop the debounce to something much smaller for the single-file
  path (the parse of one file is milliseconds).
- Diagnostics should be recomputed after the partial update (the provider
  already recomputes from the maps, so it keeps working).

## 9. Full HTML tooling inside Spacebars files (embedded language service)

Because the extension claims `.html` as the `spacebars` language, VS Code's
built-in HTML completions, Emmet, tag auto-close and hover are lost. WebStorm
keeps templates as first-class HTML with Handlebars layered on top - this is
its most noticeable day-to-day advantage.

Implementation notes:

- Add `vscode-html-languageservice` to the server and create an
  `HtmlLanguageService` wrapper that parses the current document.
- In each provider (completion/hover/definition), when the position is NOT
  inside a mustache (reuse the `text-utils.js` detection), delegate to the
  HTML language service and merge/return its result.
- For Emmet, add `"emmet.includeLanguages": { "spacebars": "html" }` as a
  documented recommendation (or contribute it via
  `configurationDefaults` in package.json).
- Consider `htmlLanguageService.getFoldingRanges` +
  `foldingRangeProvider` capability while at it.

## 10. Spacebars formatting

There is no formatter for `.html` Spacebars files; WebStorm formats
Handlebars templates natively.

Implementation notes:

- Two viable routes:
  1. Prettier with an embedded-handlebars strategy: run `prettier` with the
     `glimmer`/`html` parser on template contents. Fastest to ship but
     mustache-block indentation support is partial.
  2. Implement `textDocument/formatting` in the server: format HTML with
     `vscode-html-languageservice`'s `format()` and post-process mustache
     block indentation ({{#if}}/{{#each}} increase indent, {{/...}} decrease).
- Route 2 pairs naturally with feature 9 since the HTML service will already
  be embedded.
- Capability: `documentFormattingProvider: true` (and optionally
  `documentRangeFormattingProvider`).
