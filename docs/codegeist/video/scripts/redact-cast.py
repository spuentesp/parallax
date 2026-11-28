#!/usr/bin/env python3
"""Prepare the Claude Code take (asciinema v2 cast) for the video.

Only presentation noise is removed; nothing Claude or Parallax wrote is changed:
  - the account usage notice ("You've used N% of your weekly limit ...")
  - local-setup notices (the Advisor Tool notice, tmux's focus-events hint)
  - the Claude Code banner logo glyphs (a third-party logo in a judged video)
Notices are replaced by spaces of the same length, keeping escape codes, so the layout is unchanged.
The take is cut just before `/exit` is typed.

Usage: redact-cast.py <in.cast> <out.cast> [first words of the first question]
(prints the time to start playback from: just before that question is typed)
"""
import json
import re
import sys

ESC = re.compile(r"(\x1b\[[0-9;?]*[A-Za-z])")
NOTICES = [
    re.compile(r"You've used \d+% of your weekly limit.*?(?=\x1b\[[0-9;]*m|\r|\n|$)", re.S),
    re.compile(r"Advisor Tool \(experimental\).*?/advisor", re.S),
    re.compile(r"(?:tmux focus-events|\S*-events on').*?tracking", re.S),
]
LOGO = re.compile(r"[▐▛▜▌▝▘▗▖▀▄█▙▟]")


def blank(m: re.Match) -> str:
    """Spaces for every printable character in the match; escape codes are kept."""
    return "".join(p if ESC.fullmatch(p) else re.sub(r"[^\r\n]", " ", p) for p in ESC.split(m.group(0)))


def main(src: str, dst: str, opening: str = "Using the Parallax") -> None:
    lines = open(src, encoding="utf-8").read().splitlines()
    header, events = lines[0], [json.loads(line) for line in lines[1:]]

    text, first_prompt, exit_at = "", None, None
    for t, _, data in events:
        text += data
        if first_prompt is None and opening[:3] in text[-600:]:
            first_prompt = t
        if exit_at is None and "/exit" in text[-300:]:
            exit_at = t

    out = []
    for t, kind, data in events:
        if exit_at is not None and t >= exit_at - 0.6:
            break
        for pat in NOTICES:
            data = pat.sub(blank, data)
        if first_prompt is None or t <= first_prompt:
            # The logo's glyphs carry a background colour: reset it too, or a dark box stays.
            data = re.sub(r"\x1b\[48;5;\d+m", "\x1b[49m", LOGO.sub(" ", data))
        out.append(json.dumps([t, kind, data]))

    open(dst, "w", encoding="utf-8").write(header + "\n" + "\n".join(out) + "\n")
    left = "".join(json.loads(line)[2] for line in out)
    for word in ("weekly limit", "Advisor Tool", "tmux.conf"):
        if word in left:
            print(f"warning: '{word}' still present", file=sys.stderr)
    start = max(0.0, (first_prompt or 0.0) - 0.5)
    print(f"{start:.2f}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
