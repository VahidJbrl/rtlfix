# Changelog

## 1.3.0 (2026-10-30)

- On a right-to-left line, the left and right arrow keys move the cursor the way the line is drawn: Right goes back through Persian text and Left goes forward, as in terminals with bidi support. Before, they moved in the agent's left-to-right order, so correcting a typo meant pressing the opposite key.
- Mouse clicks and selections on right-to-left lines point at the character under the pointer, so Claude Code's own selection highlights what you drag over and copies that text.
- On Windows, text copied from a mouse selection in Claude Code reaches the clipboard in reading order. Claude Code itself copies it there in display order.
- Claude Code's prompt chips, such as `[⧉ In file]` for the file open in the editor, no longer make the typed Persian text left to right.
- To do this, rtlfix now passes the keyboard on to the program itself. On Linux it also keeps the inner terminal's size in step with the window.

## 1.2.2 (2026-10-29)

- Claude Code's session recap (`※ recap: …`) and other Persian lines that start with a one-word English label, such as `Note:`, are laid out right to left, so they read in the right order. Before, the English label made the whole first line left to right.

## 1.2.1 (2026-10-29)

- On Windows, typing a space after Persian text in Claude Code's prompt no longer pushes the text to the left. The text stays where it is and the cursor moves, as on Linux.

## 1.2.0 (2026-10-29)

Windows support.

- `rtlfix claude`, `rtlfix qwen` and `rtlfix tui` work natively on Windows 10 version 1809 and newer, in PowerShell and the command prompt, for example in VS Code's terminal. A small pseudo console helper written in C# takes the place of util-linux `script`. It is built on first use with the C# compiler that comes with Windows and kept in `%LOCALAPPDATA%\rtlfix`.
- In VS Code, Cursor and similar editors the helper uses the console host that the editor ships with, so the agent's output reaches rtlfix exactly as written. The console built into Windows counts the Persian half-space (ZWNJ) as a column, which garbles Claude Code's screen.
- Claude Code on Windows always puts right-to-left text in display order itself. rtlfix turns each line back into reading order and then draws it as on Linux. For lines that mix Persian and English, the way Claude Code wrapped the line and the punctuation at its ends tell which direction it used.
- Programs are found the way cmd.exe finds them, with PATH and PATHEXT. `.cmd` and `.bat` files such as npm's `claude.cmd` are started through cmd.exe with their arguments escaped, and the exit code is passed on.
- Typing works as before, including Persian punctuation such as «،» and «؛» that Windows sends as Alt+Numpad sequences.
- Window resizes reach rtlfix before the program redraws.
- Right-aligned lines leave room for marks such as the tanvin, which the console built into Windows gives a column of their own.
- `rtlfix doctor` checks the Windows version and the C# compiler and shows which console host is used. `rtlfix install` points to npm on Windows.

On every platform:

- A mark on an alef, such as the tanvin in «مثلاً», is no longer lost when the alef joins a lam.
- A list item inside a bullet (`● - …`) keeps both markers in front of the text.

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
