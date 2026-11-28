#!/usr/bin/env python3
"""Synthesize one MP3 per scene from script.md's '## Narration' sections with MiniMax (mmx).
Usage: narrate.py [scene numbers...]   (default: all). Output: out/audio/scene-N.mp3"""
import re, subprocess, sys
from pathlib import Path
root = Path(__file__).resolve().parent.parent
text = (root / "script.md").read_text()
narr = text.split("## Narration", 1)[1].split("## Pipeline", 1)[0]
scenes = {int(m.group(1)): " ".join(m.group(2).split())
          for m in re.finditer(r"^### (\d+)\.[^\n]*\n(.*?)(?=^### |\Z)", narr, re.S | re.M)}
want = [int(a) for a in sys.argv[1:]] or sorted(scenes)
out = root / "out" / "audio"; out.mkdir(parents=True, exist_ok=True)
voice = "English_expressive_narrator"
for n in want:
    dst = out / f"scene-{n}.mp3"
    subprocess.run(["mmx", "speech", "synthesize", "--text", scenes[n], "--voice", voice,
                    "--out", str(dst), "--quiet", "--non-interactive"], check=True)
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(dst)],
                         capture_output=True, text=True).stdout.strip()
    print(f"scene {n}: {dur}s  ({len(scenes[n].split())} words)")
