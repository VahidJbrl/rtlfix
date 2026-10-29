# Changelog

## 1.1.0 (2026-10-28)

Fixes found by testing rtlfix against xterm.js itself, real Claude Code and Qwen Code sessions, Unicode's conformance tests and random terminal output.

- Works with Claude Code's classic renderer, which most people use. rtlfix now asks the terminal where the cursor is when it starts, instead of assuming the top-left corner, so Persian text is no longer drawn on the wrong rows when the agent starts below earlier output.
- Persian lines that scroll off the screen in one burst now reach the scrollback drawn, instead of blank.
- Window resizes follow xterm.js: rows move into and out of the scrollback the way the terminal moves them, and after the terminal re-wraps lines rtlfix draws relative to the cursor until the program positions it again.
- Sentences that start with a number (`۱. ...`, `2026 ...`) are laid out right to left.
- The full Unicode Bidirectional Algorithm, including explicit embeddings and isolates, with tables generated from Unicode 18.0. It passes all of `BidiTest.txt` and `BidiCharacterTest.txt`.
- Character widths match xterm.js exactly. Before, invisible marks such as RLM took a cell and shifted the rest of the line.
- Long lines wrap the way the terminal wraps them, so copying and re-wrapping them works.
- Line-drawing characters, hyperlinks, insert mode, origin mode, tab stops, saved cursors per screen and other terminal state survive a redraw.
- Joining with tatweel and ZWJ; lam-alef only for the four alef ligatures.
- `rtlfix claude` and `rtlfix qwen` as shortcuts for `rtlfix tui claude` and `rtlfix tui qwen`.
- rtlfix inside rtlfix runs the program directly instead of reversing the text twice.
- Signals: the agent gets the signal rtlfix received, and rtlfix exits with 128 plus the signal number.
- `--` inside the program's own arguments is passed on.
- Without util-linux `script`, rtlfix starts the program directly with a note.
- Text mode: each line takes its own direction, output streams line by line, colours stay on their words, lines without RTL letters pass through byte for byte, and RTL lines are aligned to the right on a terminal. `--width=n`, `-wn` and `--` are accepted, and `| head` no longer prints an error.
- `rtlfix install` writes a small launcher that keeps working after a Node.js upgrade, can be run again from the installed copy, and refuses to overwrite files it did not create. `rtlfix uninstall` removes only what it installed.
- A clear message on Node.js older than 18, and `doctor` exits with an error when something is missing.

## 1.0.0 (2026-10-23)

First public release.

- `rtlfix tui <program>` runs Claude Code, Qwen Code or any other terminal program with Persian, Arabic and Hebrew drawn correctly in terminals without RTL support: joined letters, Unicode bidi order, mirrored brackets, right-aligned paragraphs and the cursor at the RTL insertion point.
- Rows without RTL text pass through untouched.
- Window resizes, Ctrl+Z and closing the terminal are handled cleanly.
- `rtlfix demo` shows whether a terminal needs rtlfix; `rtlfix doctor` checks the requirements.
- `rtlfix [text]` prints joined, visually ordered text for pipes and files.
