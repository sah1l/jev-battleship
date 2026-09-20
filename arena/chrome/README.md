# Browser matches

`matches.json` holds two head-to-head games played on the live game page, where a frontier model
drove Chrome and hunted Jev's fleet while Jev hunted its own. Every turn records both boards, both
shots and Jev's round trip in milliseconds.

| | Claude Fable 5.1 | Astra (Codex) |
|---|---:|---:|
| Shots the rival needed to win | 27 | 37 |
| Jev's hits, of the 12 needed | 10 | 10 |
| Jev's mean round trip | 814 ms | 963 ms |
| Jev's tokens, whole match | 102,980 | 131,446 |
| Jev's cost | $0.0043 | $0.0055 |

Totals come from the game page's own end screen. Jev's per turn latencies were recovered from the
screenshots taken after every shot, and their mean matches the page to the millisecond.

The raw captures are roughly 80 MB of PNGs and are not committed, so the reconstruction script is
not here either. `matches.json` is its output and is all `../render_chrome.py` needs.

These round trips are slower than the 388 ms median the arena measures. The agents took 14 to 19
seconds per turn, so most calls opened a fresh connection.
