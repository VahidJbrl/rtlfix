# Changelog

## 1.4.5 (2026-11-01)

Persian lines line up.

- Persian lines now mirror Claude Code's own layout exactly, so paragraphs, list items and wrapped lines share the same right edge. Before, a line that filled the whole width of the terminal sat one column to the right of the others.
- On Windows, a line with a mark such as the tanween in `تقریباً` lines up too. rtlfix now checks once at startup whether the terminal gives such marks a cell of their own, instead of assuming it does.

## 1.4.4 (2026-10-31)

Numbers in front of English words.

- In Persian text, a number in front of English words stays in front of them, so `آدرس 12 E Main St` reads `12 E Main St` instead of `E Main St 12`, and a date reads `10 June 2026`.
- On Windows, where Claude Code has already reordered the line, this happens when the words around the number make it clear, such as `آدرس`, a month, `W` or `GB`. Otherwise the line stays as Claude Code drew it.

## 1.4.3 (2026-10-31)

- On Windows, clicking a letter in Claude Code's prompt puts the cursor on that letter in Persian text too. Before, a click on Persian landed on the mirrored position.

## 1.4.2 (2026-10-31)

Persian sentences that start with an English word.

- A Persian line, list item or table cell that starts with an English word, such as `Python را نصب کنید.`, reads right to left. English sentences with a Persian word, and code, keep their direction.
- On Windows, numbers next to English words land where they belong, for example in `Python 3.12` and `10 June 2026`.
- On Windows, Persian typed after an English word in Claude Code's prompt reads right to left while you type.

## 1.4.1 (2026-10-31)

Fixes for Persian mixed with English in Claude Code on Windows.

- Lines that mix Persian with English, numbers or brackets read in the right order, with brackets facing the right way and numbers such as `95%` kept whole.
- Tables keep their columns, including Persian headers and cells that wrap onto a second line.
- On every platform, a wrapped table cell keeps its direction on the next line, and signs at the edge of an English word stay with it, so `_old_versions`, `C++`, `C#` and `C:\Users\` read as written.

## 1.4.0 (2026-10-31)

macOS support.

- `rtlfix claude`, `rtlfix qwen` and `rtlfix tui` work on macOS, for example in VS Code's terminal, with nothing else to install.
- `rtlfix doctor` checks the setup on macOS.

## 1.3.1 (2026-10-31)

Fixes for Claude Code on Windows.

- Dragging the mouse across several Persian lines selects and copies the text in reading order.
- The first line of a Persian paragraph no longer sometimes shows in the wrong direction.

## 1.3.0 (2026-10-30)

Editing and selecting right-to-left text.

- The left and right arrow keys move through Persian text the way it is shown, so fixing a typo no longer takes the opposite key.
- Mouse clicks and selections on Persian lines land on the character under the pointer.
- On Windows, text copied from Claude Code reaches the clipboard in reading order.
- Typed Persian stays right to left when Claude Code puts a chip such as `[⧉ In file]` in front of it.

## 1.2.2 (2026-10-29)

- Persian lines that start with a one-word English label, such as Claude Code's `※ recap:` or `Note:`, read right to left instead of coming out scrambled.

## 1.2.1 (2026-10-29)

- On Windows, typing a space after Persian text in Claude Code's prompt no longer shifts the text to the left; only the cursor moves.

## 1.2.0 (2026-10-29)

Windows support.

- `rtlfix claude`, `rtlfix qwen` and `rtlfix tui` run natively on Windows 10 (version 1809) and later, in PowerShell, the command prompt or VS Code's terminal.
- Claude Code reorders Persian itself on Windows; rtlfix puts each line back in reading order and draws it as on Linux.
- Persian punctuation such as «،» and «؛» can be typed as usual.
- Works best in VS Code, Cursor and similar editors. In other Windows terminals, Persian half-spaces can shift parts of Claude Code's screen.
- On every platform, a mark on lam-alef, such as the tanvin in «مثلاً», is kept, and nested list markers stay in front of the text.

## 1.1.0 (2026-10-28)

Fixes from testing against real Claude Code and Qwen Code sessions, VS Code's terminal engine and Unicode's own test suite.

- Works with Claude Code's default display: Persian is no longer drawn on the wrong rows when Claude Code starts below earlier output.
- Persian lines stay correct when they scroll away, when the window is resized and when long lines wrap.
- Text order follows the full Unicode bidirectional algorithm and passes all of Unicode's conformance tests.
- Character widths match the terminal exactly, so invisible marks no longer shift a line.
- `rtlfix claude` and `rtlfix qwen` as shortcuts.
- Safer install and uninstall, and clearer error messages.

## 1.0.0 (2026-10-23)

First release. rtlfix shows Persian, Arabic and Hebrew correctly in terminals without right-to-left support, such as VS Code's.

- `rtlfix tui <program>` runs Claude Code, Qwen Code or any other terminal program with letters joined, words in reading order, brackets mirrored and paragraphs aligned to the right.
- `rtlfix "text"` does the same for text in pipes and files.
- `rtlfix demo` shows whether a terminal needs rtlfix, and `rtlfix doctor` checks the setup.
