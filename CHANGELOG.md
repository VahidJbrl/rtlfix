# Changelog

## 1.4.16 (2026-11-21)

A Persian command title no longer shifts while the command runs.

- On Windows, while Claude Code runs a command with a Persian description in fullscreen mode, the bullet in front of the description blinks. Each time the bullet went out, the description moved one column to the left, and back when it came on again. It now stays in place, the same as on Linux and macOS.

## 1.4.15 (2026-11-21)

The choices in Claude Code's questions stay in place.

- In a question asked in Persian, a choice written only in English, such as a place name, stayed on the left while the other choices were on the right. Every choice now takes the direction of the question, the field for your own answer too, so that line no longer moves when you start typing in it.
- A choice that mixes English and Persian no longer jumps to the left when you point at it with the mouse. Claude Code colors the line under the pointer, and rtlfix now looks past that color.
- A click in the empty part of a right-to-left line, past the end of its text, puts the cursor at the end of the text. Before, it landed one letter short, for example when you clicked at the end of the prompt to go on typing.
- When you type English into a field drawn right to left, the cursor stays after the last letter on Windows too, and the left and right arrow keys move through the English text in their usual direction.

## 1.4.14 (2026-11-21)

Claude Code's questions with choices look right while you choose and type.

- On Windows, the checkbox of the highlighted choice, and of the answer you type yourself, was drawn reversed at the far end of the line and moved along with the cursor as you typed, and an English word typed among Persian words, such as `csv` or `API`, landed in the wrong place. The checkbox now stays next to the number, and what you type keeps its order, also when you type in the middle of the text.
- A choice that mixes English and Persian no longer changes sides as the highlight moves on and off it.
- The left and right arrow keys switch to the next and previous question as expected. While a Persian choice was highlighted they worked the other way round. Inside text you type they still follow the line's direction.
- The question tabs at the top keep their order, each checkbox beside its label, the same on Linux, macOS and Windows. Claude Code sends the replacement character U+FFFD in place of a half-space in a tab label; rtlfix shows it as a space.

## 1.4.13 (2026-11-20)

English items in a Persian list line up with the rest of the list.

- In a Persian answer, a list item written in English or mostly in English, such as `Central Park:` or a name followed by a few Persian words, was drawn left to right with its number or bullet on the left, out of line with the Persian items around it. rtlfix now gives such an item the direction of its list: when the line that introduces the list, or the item it sits under, is Persian, the item is drawn right to left with its marker on the right. This works the same on Linux, macOS and Windows.
- English stays English: lists under an English heading such as `Sources:`, long English sentences inside a Persian list, and English answers keep their direction.
- The part of a right-to-left item or paragraph that wraps onto the next row stays right to left, even when that row holds only English words. A command or other text on its own line after a Persian sentence still starts at the left.
- In Claude Code's fullscreen mode, items keep their direction when the top of their list scrolls out of view, also under the prompt that Claude Code pins to the top while you scroll.

## 1.4.12 (2026-11-20)

Claude Code on Windows keeps working after the terminal is resized.

- Since 1.4.11, making the terminal wider during a Claude Code session on Windows, for example by closing a side bar or enlarging the window, could make rtlfix stop for the rest of that session. Persian then came out exactly as Claude Code sends it: words in reverse order, letters apart, and list markers and labels such as `summary` on the wrong side. Lines are now drawn again at the new width.
- After a resize, clicks and copied selections no longer use a line's layout from before the resize.
- If a single line ever cannot be laid out, only that line is shown as the program sent it, and rtlfix keeps working for everything else.

## 1.4.11 (2026-11-18)

Search boxes and typing in Claude Code on Windows.

- In Claude Code's search boxes on Windows, such as the one in `/resume`, rtlfix turned the whole box around like a table row. Persian text was drawn at the right edge while the cursor stayed at the left, away from it, and mixed Persian and English came out of order. rtlfix now turns back only the text inside the box, as Claude Code wrote it, so the text and the cursor sit where they do on Linux.
- In a search box with Persian text, the left and right arrow keys now move the cursor the way it looks, as they already did in the prompt.
- While you type on Windows, rtlfix uses what the line held a moment before to settle where each word belongs. A number or a hyphen typed after Persian words now stays where it was typed, in the prompt and in search boxes, and answers keep numbers in place more often while they stream in.

## 1.4.10 (2026-11-18)

Numbers stay with their units in Claude Code on Windows.

- Claude Code on Windows sends Persian lines already reordered, and rtlfix works out the original order before drawing them. Where a number stood between Persian text and an English word, it sometimes picked the wrong side: `16 GB` came out as `GB 16`, and in a list item that starts with an English name, a number could jump next to the name. rtlfix now knows common units such as GB, GHz, ms, oz, lb, ml, PM and days, and keeps a number in front of them, as on Linux.

## 1.4.9 (2026-11-17)

One cursor in Qwen Code's prompt.

- Qwen Code draws its own cursor in the prompt: a highlighted space on Linux and macOS, an underlined one on Windows. When an English word ended a Persian line, rtlfix put that cell at the far left of the line while the real cursor stood after the English word, so a second cursor or a stray underline showed until the next space. Now both sit where the next letter goes.

## 1.4.8 (2026-11-17)

Qwen Code's scrollbar stays on the right.

- Qwen Code shows a scrollbar in the last column for a moment after each scroll or update. On lines with Persian, rtlfix turned it around with the text, so thick bars flashed on the left of the text. It now stays in the last column, and the text beside it no longer shifts when the scrollbar appears or hides.

## 1.4.7 (2026-11-16)

Persian in quotes is readable.

- Persian and Arabic letters are now drawn upright where the program asks for italic, as in Claude Code's quotes, its recap line and `*emphasis*`. Terminals have no italic font that joins these letters, so italic Persian came out as loose letters in a different font. English text keeps its italic, and colours, bold and dim stay as they were. Piped text gets the same treatment.

## 1.4.6 (2026-11-06)

rtlfix stays out of Claude Code's way.

- On Windows, programs that Claude Code leaves running keep running after it exits, as they do without rtlfix. Before, closing Claude Code also closed anything started from it, such as a long job, a browser or an editor.
- On Windows, closing the terminal lets Claude Code shut down normally instead of stopping it at once.
- On Windows, rtlfix finds the console host in current versions of VS Code and runs a private copy of it, so it holds no files that VS Code or Cursor need for their own updates.
- On Linux and macOS, Ctrl+Z suspends Claude Code to the shell and `fg` brings it back.
- On macOS, Claude Code and Qwen Code get the keyboard. Before, they ran in the background of their terminal and could not read what you typed.

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
