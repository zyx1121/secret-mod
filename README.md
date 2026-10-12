<div align="center">

<h1>secret-mod</h1>

<p><strong>Credentials that Claude Code can use but never sees: a form above the prompt, the macOS keychain, masked output.</strong></p>

[![CI](https://img.shields.io/github/actions/workflow/status/zyx1121/secret-mod/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/zyx1121/secret-mod/actions)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-mod-d97757?style=flat-square)](https://github.com/anthropics/claude-code/tree/main/mods)
[![macOS](https://img.shields.io/badge/macOS-only-000000?style=flat-square&logo=apple)](hooks)
[![License](https://img.shields.io/github/license/zyx1121/secret-mod?style=flat-square)](LICENSE)

**English** | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

</div>

When Claude needs a password or a token, it asks for it with a tool. You type the value into a form above the prompt.

```
╔═[ WinFra GitLab personal access token ]═══════════════ NEW ═╗
║ account : [_______________________________________________] ║
║ token   : [_______________________________________________] ║
╟─────────────────────────────────────────────────────────────╢
║                    < Save >    < Cancel >                   ║
╚═════════════════════════════════════════════════════════════╝
```
 The value goes to the login keychain, and Claude gets only the name.

## Features

- **Form above the prompt**: a retro dialog with a double frame, the purpose as its title, one line per field and `< Save >` `< Cancel >`. Enter moves to the next field.
- **Keychain storage**: each secret is a generic password `kilo/<name>`. The value goes to `security` through stdin, never through argv.
- **Index without values**: `list` reads names, accounts and comments from the keychain.
- **Use without seeing**: `run` starts a command with the secrets as env vars and masks every value in the output.
- **Update and delete**: `ask` with the same name updates an item and keeps its account. `delete` asks you first.

## Quick start

Function hooks are in early access. Turn them on in your shell profile:

```sh
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
```

Then install the mod in Claude Code:

```
/plugin marketplace add zyx1121/secret-mod
/plugin install secret-mod@secret-mod
```

## Usage

The mod adds 4 tools, listed as `mcp__secret-mod__<name>`:

| Tool | Does |
|------|------|
| `ask` | Shows the form for `kilo/<name>`. It returns at once, and a message starts the next turn when you save or cancel |
| `run` | Runs `zsh -c <command>` with the secrets as env vars, output masked |
| `list` | Lists the `kilo/` items with their env var names |
| `delete` | Deletes `kilo/<name>` after you confirm |

The form takes the keyboard after a click or `ctrl+x tab`.

For the secret `nycu-portal`, `run` sets:

| Env var | Value |
|---------|-------|
| `NYCU_PORTAL` | the stored value |
| `NYCU_PORTAL_ACCOUNT` | the account |
| `NYCU_PORTAL_<FIELD>` | each field, when the item holds several (stored as JSON) |

## Limits

- Masking stops the value itself, not what a command derives from it. A hash or a length still reaches Claude.
- Claude can still read the keychain with Bash (`security find-generic-password -w`). Add a deny rule in `settings.json` to block it.
- The form shows what you type in plain text.
- macOS only.

## For AI agents

- **Summary**: Claude Code function-hooks mod that collects credentials in a form, keeps them in the macOS login keychain and runs commands with them without returning the values to the model.
- **Type**: plugin
- **Interfaces**: tools `mcp__secret-mod__ask`, `run`, `list`, `delete`; `AbovePrompt` form
- **Install**: `/plugin marketplace add zyx1121/secret-mod`, then `/plugin install secret-mod@secret-mod`
- **Run**: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .`
- **Verify**: `bunx -p typescript tsc -p tsconfig.json && CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .`
- **Config**: none
- **Secrets**: stored by the mod in the login keychain under `kilo/<name>`
- **Limits**: macOS. Masking does not cover derived output.

## Development

```sh
bunx -p typescript tsc -p tsconfig.json                    # typecheck
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .   # the engine's test harness
```

`types/claude-code.d.ts` is the engine contract that Claude Code writes for mods. When the engine changes, copy the new version and let the typecheck show what moved.

## License

[MIT](LICENSE)
