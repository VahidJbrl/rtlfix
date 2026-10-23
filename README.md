<div align="center">

# rtlfix

**Persian, Arabic and Hebrew that read right in your terminal AI agent.**

Claude Code, Qwen Code or any terminal program, in VS Code's integrated terminal<br>
and every other terminal that cannot draw right-to-left text.

[![CI](https://github.com/VahidJbrl/rtlfix/actions/workflows/ci.yml/badge.svg)](https://github.com/VahidJbrl/rtlfix/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
![Dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen.svg)
![Linux and WSL](https://img.shields.io/badge/platform-Linux%20%7C%20WSL-lightgrey.svg)

<img src="docs/before-after.png" alt="The same Claude Code conversation in VS Code's terminal, without rtlfix (letters not joined, brackets flipped, everything on the left) and with rtlfix (joined letters, right-to-left layout, mirrored brackets, cursor where you type)" width="880">

</div>

## Quick start

```bash
npm install -g github:VahidJbrl/rtlfix
rtlfix tui claude
```

That's all. Use `rtlfix tui qwen` for Qwen Code, or put any other program after `rtlfix tui`.

Not sure whether your terminal needs it? Run `rtlfix demo`.

<div dir="rtl">

**به فارسی:** rtlfix متن فارسی، عربی و عبری را در ترمینال VS Code و ترمینال‌های مشابه درست نمایش می‌دهد: حروف به هم می‌چسبند، ترتیب کلمات درست می‌ماند، پرانتزها درست باز و بسته می‌شوند و متن از سمت راست شروع می‌شود. کافی است Claude Code یا Qwen Code را با دستور `rtlfix tui claude` یا `rtlfix tui qwen` اجرا کنید.

</div>

## What it fixes

| | Without rtlfix | With rtlfix |
|---|---|---|
| **Letters** | Drawn one by one, never joined | Joined, the way Persian and Arabic are written |
| **Word order** | Qwen Code and most programs: every word reads backwards | Correct, with English words, file names, numbers and code kept intact |
| **Brackets** | `(` and `)` point the wrong way | Mirrored where they belong to RTL text |
| **Alignment** | Everything hugs the left edge | Persian paragraphs start on the right; English stays on the left |
| **Typing** | The cursor sits at the wrong end of the line | The cursor is where the next letter goes, also inside an English word |

<div align="center">
<img src="docs/typing.gif" alt="Typing a Persian sentence with an English file name, without and with rtlfix" width="760">
</div>

## Install

**With npm** (recommended)

```bash
npm install -g github:VahidJbrl/rtlfix
```

If npm reports a permission error, install into your home directory instead and make sure `~/.local/bin` is on your `PATH`:

```bash
npm install -g --prefix ~/.local github:VahidJbrl/rtlfix
```

**Without npm**

```bash
git clone https://github.com/VahidJbrl/rtlfix.git
cd rtlfix
node src/cli.mjs install
```

**Try it without installing**

```bash
npx github:VahidJbrl/rtlfix tui claude
```

**Requirements:** Linux or WSL, Node.js 18 or newer, and `script` from util-linux, which most distributions include. `rtlfix doctor` checks all three.

## Usage

| Command | What it does |
|---|---|
| `rtlfix tui claude` | Starts Claude Code with right-to-left text drawn correctly |
| `rtlfix tui qwen` | The same for Qwen Code |
| `rtlfix tui <program> [args...]` | Any other terminal program, with its own arguments |
| `rtlfix demo` | Shows whether this terminal needs rtlfix |
| `rtlfix doctor` | Checks Node.js, util-linux and which agents are installed |
| `rtlfix "text"` or `… \| rtlfix` | Prints text ready for this terminal, e.g. `qwen -p "سلام" \| rtlfix` |

To use it every time you open an agent in VS Code, add aliases to `~/.bashrc` (or `~/.zshrc`):

```bash
if [ "$TERM_PROGRAM" = "vscode" ]; then
  alias claude='rtlfix tui claude'
  alias qwen='rtlfix tui qwen'
fi
```

The aliases are safe in scripts and pipes: when its output is not a terminal, `rtlfix tui` simply runs the program unchanged.

## How it works

```
keyboard ─────────────────────────────────►  claude / qwen
screen   ◄──────  rtlfix  ◄───────────────────────┘
```

- The agent runs in its own pseudo-terminal. Your keystrokes go straight to it, so typing, shortcuts, mouse and paste behave exactly as before.
- rtlfix keeps a model of the agent's screen. Lines without right-to-left text reach your terminal byte for byte as the agent wrote them.
- Lines that contain Persian, Arabic or Hebrew are redrawn: the [Unicode Bidirectional Algorithm](https://www.unicode.org/reports/tr9/) puts them in visual order, letters are replaced by their joined forms, brackets are mirrored, the paragraph is aligned to the right, and the cursor is placed at the visual insertion point.
- It only changes what is displayed. What you type, the conversation history and what the model sees stay exactly as they are.
- Window resizes, Ctrl+Z and closing the terminal are handled; when the terminal closes, the agent closes with it.

Claude Code reorders right-to-left text by itself when it detects VS Code, but without joining letters or mirroring brackets, and that result cannot be reordered again reliably. So rtlfix starts Claude Code without the VS Code hint and turns the matching features back on with Claude Code's own documented settings: IDE auto-connect, synchronized output, strikethrough and hyperlinks. Settings you have chosen yourself always win.

## FAQ

**The text looks reversed with rtlfix.**
Your terminal already handles right-to-left text (for example GNOME Terminal or Konsole). Run your agent directly there. `rtlfix demo` tells you which case you are in.

**Persian letters show up as empty boxes.**
The terminal's font has no Arabic glyphs. Add a font that has them, for example DejaVu Sans Mono or Vazir Code, to `terminal.integrated.fontFamily` in VS Code.

**Does it work on macOS or Windows?**
`rtlfix tui` needs Linux or WSL, because it uses util-linux `script`. On Windows, run your agent inside WSL, for example in VS Code with the WSL extension. Text mode (`rtlfix "text"`) works everywhere Node.js runs.

**Does it change what the model reads?**
No. rtlfix only rewrites the bytes on their way to your screen.

**How do I uninstall it?**
`npm uninstall -g rtlfix`, or `rtlfix uninstall` if you installed it without npm.

## Limitations

- Copying with the terminal's own selection copies the joined glyphs in display order. To get the original text, copy from the agent itself (for example Claude Code's `/copy`).
- A mouse click on a right-to-left line lands where the agent's own left-to-right layout has that column.
- Something an agent draws on top of a line of text, such as a floating hint, is laid out together with that line.
- Tables keep their left-to-right column order; the text inside each cell is laid out right to left.

## Development

```bash
git clone https://github.com/VahidJbrl/rtlfix.git
cd rtlfix
npm test
```

There are no dependencies to install. The code lives in `src/`:

| File | Purpose |
|---|---|
| `relay.mjs` | Screen model and redrawing of right-to-left lines |
| `bidi.mjs` | Unicode Bidirectional Algorithm for a single line |
| `shaping.mjs`, `arabic-tables.mjs` | Arabic letter joining; the tables come from Unicode 15.1 via `scripts/gen-arabic-tables.mjs` |
| `tui.mjs` | Starting the program in a pseudo-terminal |
| `text.mjs`, `width.mjs` | Text mode, wrapping and character widths |
| `cli.mjs`, `setup.mjs` | Command line, `demo`, `doctor`, `install` |

## License

[MIT](LICENSE) © Vahid Jebraeeli
