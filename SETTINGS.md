# Meteor Impact - Settings reference

Everything Meteor Impact reads, everything it can write for you, and the
VS Code settings that unlock its features.

## 1. Extension settings

All of Meteor Impact's own options live under a single object:

```jsonc
"conf.settingsEditor.meteorImpact": {
    // Watch the packages folder and automatically update jsconfig.json.
    // Toggle with the "Toggle Meteor Impact Auto Run" command.
    "auto": true,

    // Port used when generating the run/debug launch configurations.
    "port": "3000",

    // Extra arguments appended to the meteor run/debug commands,
    // e.g. "--settings settings.json". Re-run "Re-create Meteor Impact
    // run/debug options" after changing it.
    "additionalArgs": null,

    // Colon-delimited list of extra local package directories, relative
    // to the workspace (besides the default "packages" folder).
    "meteorPackageDirs": null,

    // Colon-delimited list of directories the language server should NOT
    // index, relative to the workspace. tests/, node_modules/ and
    // *.tests.js/ts are always excluded.
    "ignoreDirsOnIndexing": null
}
```

## 2. Editor settings that unlock features

These are standard VS Code settings; Meteor Impact provides the
functionality behind them.

### Format Spacebars templates on save

```jsonc
"[spacebars]": {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "gabdsg.meteor-impact",
    "editor.tabSize": 4,
    "editor.insertSpaces": true
}
```

`defaultFormatter` is only strictly needed when another extension also
claims spacebars files. `"editor.formatOnSaveMode": "modifications"` is
supported too (range formatting).

### Linked tag editing

Edit an opening HTML tag and the closing tag follows:

```jsonc
"[spacebars]": {
    "editor.linkedEditing": true
}
```

### Completion inside strings

`Meteor.call("...")`, `Meteor.subscribe("...")` and event key selector
completions live inside string literals, where VS Code doesn't auto-suggest
by default:

```jsonc
"[javascript]": { "editor.quickSuggestions": { "strings": true } },
"[typescript]": { "editor.quickSuggestions": { "strings": true } }
```

Without this, trigger them manually with Ctrl+Space.

### Emmet in templates

Meteor Impact contributes this as a default; set it explicitly only if
something overrides it:

```jsonc
"emmet.includeLanguages": { "spacebars": "html" }
```

### Semantic colors for mustaches

Resolved symbols get semantic token types: helpers -> `function`,
`{{> templates}}` -> `class`, block keywords -> `keyword`, block variables
-> `variable`. Unresolved paths keep the plain grammar color on purpose.
Themes color these already; customize them with:

```jsonc
"editor.semanticTokenColorCustomizations": {
    "rules": {
        "function": { "foreground": "#DCDCAA" },
        "class":    { "foreground": "#4EC9B0" },
        "keyword":  { "foreground": "#C586C0" },
        "variable": { "foreground": "#9CDCFE" }
    }
}
```

## 3. Settings written by commands

### Nest Template Files Under Code-Behind

Off by default. The command writes these two built-in settings into the
workspace `.vscode/settings.json`, merging with any patterns you already
have:

```jsonc
"explorer.fileNesting.enabled": true,
"explorer.fileNesting.patterns": {
    "*.ts": "${capture}.html, ${capture}.less, ${capture}.css",
    "*.js": "${capture}.html, ${capture}.less, ${capture}.css"
}
```

Disable by flipping `explorer.fileNesting.enabled` to `false` (patterns
stay for later), or remove both keys to undo entirely. Related:
`"explorer.fileNesting.expand": false` makes nests start collapsed.

### Generated files

- `jsconfig.json` and `.vscode/launch.json` are managed by the packages
  watcher / run options commands. Keep them out of version control.
- `meteor-settings.d.ts` is written by "Generate Meteor.settings Types"
  from your `settings*.json`. Usage:
  `const settings = Meteor.settings as MeteorSettings;`

## 4. Keybindings

| Command | Default | When |
| --- | --- | --- |
| Go to Template Counterpart | `Alt+O` | editor focus, Meteor project |

Rebind under Preferences: Keyboard Shortcuts -> `meteorImpact.goToCounterpart`.

## 5. Debugging the language server

```jsonc
"meteor-impact-language-server.trace.server": "verbose"
```

Logs the LSP traffic to the "Meteor Impact Language Server" output
channel. Leave it `"off"` normally - it is noisy.

## Full example

```jsonc
{
    "conf.settingsEditor.meteorImpact": {
        "auto": true,
        "port": "3000",
        "additionalArgs": null,
        "meteorPackageDirs": null,
        "ignoreDirsOnIndexing": "private:public"
    },
    "[spacebars]": {
        "editor.formatOnSave": true,
        "editor.defaultFormatter": "gabdsg.meteor-impact",
        "editor.linkedEditing": true,
        "editor.tabSize": 4,
        "editor.insertSpaces": true
    },
    "[javascript]": { "editor.quickSuggestions": { "strings": true } },
    "[typescript]": { "editor.quickSuggestions": { "strings": true } }
}
```
