# ClearMind

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that follows the current prompt in a side pane, so you can see where Claude is without reading every line of the transcript.

The pane is cleared each time you send a new prompt, and shows:

- **The prompt** being worked on (its first line).
- **The plan**: the steps Claude keeps with its task tools (`TodoWrite`, `TaskCreate` / `TaskUpdate`), as `○` pending, `●` in progress, `✓` done, with a `Plan 1/3` counter.
- **The journal**:
  - each tool call (`…` running, `✓` done, `✗` failed), with a short label such as `Bash · Run the tests` or `Edit src/parser.ts`;
  - the first line of each message Claude writes in the transcript (`› …`);
  - the end of the turn (`■ Done in 42s`).

The actions of a step stay listed while the step is in progress. Once it is completed, they fold into one line: `✔ Reproduce the bug (4 actions)`. When Claude keeps no plan, the journal is a flat, chronological list.

ClearMind only reads what the session already shows: tool calls and the text of Claude's messages. It makes no network calls and keeps its state in the session.

## Requirements

Claude Code v2.1.287 or later (mods). Tested with Claude Code 2.1.288.

## Install

```bash
claude plugin marketplace add cicoub13/cc-plugin-clearmind
claude plugin install clearmind@clearmind
```

Or, inside a session: `/plugin marketplace add cicoub13/cc-plugin-clearmind`, then `/plugin install clearmind@clearmind`.

## Use

- `/clearmind` opens or closes the pane.
- In a wide fullscreen terminal the pane is a sidebar to the right of the transcript; otherwise it is a framed region above the prompt.
- The pane opens by itself at session start when the terminal is at least 144 columns wide.

## Develop

```bash
git clone git@github.com:cicoub13/cc-plugin-clearmind.git
claude --plugin-dir ./cc-plugin-clearmind
```

Claude Code reloads the mod when a file changes, and writes the type declarations for your build into `.claude-plugin/types/` (git-ignored); the root `tsconfig.json` extends them.

```bash
claude plugin validate .claude-plugin/plugin.json   # what Claude Code reads from the mod
claude plugin validate .                            # the marketplace
claude plugin test .                                # tests/*.test.ts
tsc -p .                                            # type-check, once the mod has loaded
```

| File | Role |
| --- | --- |
| `hooks/register.tsx` | The hooks module: events and pane drawing |
| `types/index.d.ts` | The session state the pane draws from |
| `tests/clearmind.test.ts` | Tests run by `claude plugin test` |
| `.claude-plugin/marketplace.json` | Makes this repository installable as a marketplace |

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.
