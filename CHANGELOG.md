# Changelog

## 1.0.0

First public release.

- `rtlfix tui <program>` runs Claude Code, Qwen Code or any other terminal program with Persian, Arabic and Hebrew drawn correctly in terminals without RTL support: joined letters, Unicode bidi order, mirrored brackets, right-aligned paragraphs and the cursor at the RTL insertion point.
- Rows without RTL text pass through untouched.
- Window resizes, Ctrl+Z and closing the terminal are handled cleanly.
- `rtlfix demo` shows whether a terminal needs rtlfix; `rtlfix doctor` checks the requirements.
- `rtlfix [text]` prints joined, visually ordered text for pipes and files.
