# Change Log

All notable changes to the "meteor-dev" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [04/07/26]

-   Add "Extract selection to template" refactoring: moves the selected HTML into a new template and replaces it with a partial; rename the generated name with F2.
-   Add semantic highlighting for Spacebars: resolved helpers, templates, block keywords and block variables get distinct colors.
-   Track `{{#each x in ...}}`/`{{#let}}` block variables: offered in completion, excluded from unresolved-helper diagnostics.
-   Add signature help for `{{helper args}}` mustaches and `Meteor.call`/`callAsync`/`subscribe` argument lists, preserving TypeScript parameter annotations.
-   Add linked editing of paired HTML tags in Spacebars files.
-   Add quick fixes for diagnostics: create missing template/helper stubs, remove unused helpers.
-   Connect event maps with template HTML: go-to-definition from event keys to targeted elements, find handlers from class/id tokens, and selector completion inside event keys.
-   Make project indexing deterministic regardless of file read order.
-   Embed the HTML language service: HTML completion, hover, folding ranges and Emmet now work in Spacebars files alongside the Blaze features.
-   Add rename refactoring for helpers, templates, methods/publications and event keys, updating definitions and usages together. Helper renames are scope-aware: only the resolved template scope (or the global helper, excluding shadowed usages) is renamed.
-   Reindex changed files incrementally (following unsaved edits) instead of reindexing the whole project on every change.
-   Add document and range formatting for Spacebars files, with mustache block indentation.
-   Fix method/publication usages not being indexed when the defining file sorted after the using file.
-   Offer context-aware completions in Spacebars templates: helpers of the wrapping template and global helpers inside `{{...}}`, template names after `{{>`.
-   Complete method and publication names inside `Meteor.call`/`callAsync`/`subscribe` string arguments.
-   Support find-references from HTML files (mustaches and partials), including definitions.
-   Add hover cards for helpers, templates, methods, publications and event keys.
-   Add outline/breadcrumbs (document symbols) and workspace symbol search for templates, helpers, events, methods and publications.
-   Publish project diagnostics: unresolved partials, unresolved helper calls with arguments, duplicate template names and unused helpers.
-   Register TypeScript documents with the language client.
-   Add TypeScript support to the language server indexer: `.js` and `.ts` files are now parsed with `@babel/parser` (estree-compatible AST), so `.ts` files no longer drop out of the index, and definition/references/completion also work from `.ts` files.
-   Index `Template.registerHelper` calls as global helpers, with definition fallback when a mustache doesn't match a template-scoped helper.
-   Index every `<template>` tag of an HTML content chunk with its precise location (previously only the first one per chunk was indexed).
-   Support `Template["kebab-name"]` computed member access and string literal helper keys when indexing helpers.
-   Index `Template.X.events` maps and support find-references on event handler keys.
-   Fix crash when resolving helpers of a template that has none indexed.

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
