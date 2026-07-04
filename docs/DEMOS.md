# Demo recordings for the marketplace page

Suggested GIFs (record at ~1000px wide, keep each under 10s; drop them in
images/demo/ and reference them from the README). VS Code has no built-in
recorder - use e.g. Kap/LICEcap/peek.

1. **Rename** - F2 on `{{> myTemplate}}`, rename, show the HTML tag,
   partial and `Template.x` in the code-behind all change.
2. **Extract template** - select a block of HTML, lightbulb -> "Extract
   selection to template...", type a name, show the helpers moving.
3. **Diagnostics + quick fix** - type `{{> typoTemplate}}`, show the
   squiggle, lightbulb -> "Create template", stub appears.
4. **Meteor Explorer** - open the panel, expand a template, click a
   helper, use search, show reveal-on-switch when changing editors.
5. **Create Blaze Template** - right-click a folder, name it, show the
   generated files opening.
