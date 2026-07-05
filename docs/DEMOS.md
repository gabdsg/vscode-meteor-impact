# Demo recordings for the marketplace page

Short GIFs in the README are the single biggest install-rate boost a
marketplace listing can get. This is the recording plan: what to record,
the exact script for each clip, and how to embed them.

## Setup (do once)

-   Record in a **small, clean sample Meteor project** (or a tidy corner
    of a real one) so file names are readable and nothing sensitive is on
    screen. The `test/integration-workspace` fixture is a starting point;
    add a couple of realistically named templates (`todoList`,
    `todoItem`, ...).
-   VS Code window ~1200x800, **zoom in twice** (`Ctrl/Cmd +`) so code is
    legible at README width. Default Dark Modern theme reads well on the
    marketplace's white page.
-   Hide noise: close the terminal panel, minimize the activity bar badge
    noise, disable other extensions in the demo window
    (`code --disable-extensions` + enable only Meteor Impact... or use a
    clean profile).
-   Recorder: [Kap](https://getkap.co) (macOS),
    [Peek](https://github.com/phw/peek) (Linux), ScreenToGif (Windows).
    Export GIF, 10-15 fps is plenty.
-   Keep each clip **under ~10 seconds and under ~5 MB**. Pause ~1s at
    the start and end so the loop is readable.
-   Save to `images/demo/<name>.gif`. The folder is `.vscodeignore`d, so
    GIFs don't bloat the .vsix - the marketplace loads README images from
    GitHub, so they just need to be committed.

## The clips

Record in this order - each sets up the next.

### 1. `completion.gif` - the hook, first thing on the page

In a template's HTML, type `{{` and pause on the helper list (template
helpers on top, globals below), pick one; then type `{{> ` and show the
template-name list. Two completions, one clip.

### 2. `definition.gif`

`Ctrl/Cmd+click` a helper in HTML -> lands on the helper in the `.ts`
code-behind. Then `Shift+F12` on the helper definition -> references in
HTML show up. HTML -> TS and back in one clip.

### 3. `rename.gif`

`F2` on `{{> todoItem}}`, type the new name, hit Enter - show the
`<template name>` tag, other partials and the `Template.todoItem` in the
code-behind all changing together (split editor: HTML left, JS right).

### 4. `extract.gif`

Select a block of HTML inside a template, lightbulb -> "Extract selection
to template...", type a name - show the new template appearing with the
helpers it used moving to the new code-behind.

### 5. `quickfix.gif`

Type `{{> typoTemplate}}` -> squiggle appears -> lightbulb -> "Create
template" -> stub appears. Fast and satisfying.

### 6. `explorer.gif`

Open the Meteor Impact activity bar panel. Expand a template in the App
Overview, click a helper (jumps to it), type in the search filter, then
switch editors and show the tree revealing the active file's template.

### 7. `scaffold.gif`

Right-click a folder -> "Create Blaze Template" -> type a name -> pick
js/ts -> show the generated folder with html/code/style files opening.

## Embedding in the README

Add a `## In action` section right after the intro paragraph, before
"Language features":

```markdown
## In action

![Helper and template completion](images/demo/completion.gif)

![Rename a template everywhere](images/demo/rename.gif)

![Extract selection to template](images/demo/extract.gif)
```

Three GIFs is the sweet spot for the top of the page (completion,
rename, extract). Link the rest from a bullet or drop them next to the
matching feature bullets. After committing, `npx @vscode/vsce package`
and skim the generated README on the next publish - vsce rewrites the
relative image URLs to raw.githubusercontent.com automatically because
`repository` is set in package.json.
