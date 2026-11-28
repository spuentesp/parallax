#!/usr/bin/env python3
"""Fit one scene's clip to its narration and mux the voice in.
Trims to the clip's 'start'/'end' marks, drops every cutN_from..cutN_to span (loading waits),
then retimes the video to the narration's length plus a short tail.
Usage: fit.py <scene-number>  ->  out/fitted/scene-N.mp4"""
import json, subprocess, sys
from pathlib import Path
n = sys.argv[1]
out = Path(__file__).resolve().parent.parent / "out"
clip, voice = out / "clips" / f"scene-{n}.mp4", out / "audio" / f"scene-{n}.mp3"
marks = json.loads((out / "clips" / f"scene-{n}.json").read_text())
cuts = sorted((marks[k], marks[k.replace("_from", "_to")]) for k in marks if k.startswith("cut") and k.endswith("_from"))
segs, t = [], marks["start"]
for a, b in cuts:
    segs.append((t, a)); t = b
segs.append((t, marks["end"]))
shown = sum(b - a for a, b in segs)
vlen = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(voice)],
                            capture_output=True, text=True, check=True).stdout)
tail = 0.6
factor = (vlen + tail) / shown
print(f"scene {n}: {len(segs)} segment(s), shown {shown:.1f}s -> {vlen + tail:.1f}s (x{1 / factor:.3f} speed)")
parts = "".join(f"[0:v]trim={a:.3f}:{b:.3f},setpts=PTS-STARTPTS[s{i}];" for i, (a, b) in enumerate(segs))
graph = (parts + "".join(f"[s{i}]" for i in range(len(segs))) + f"concat=n={len(segs)}:v=1:a=0[c];"
         f"[c]setpts={factor:.5f}*PTS,fps=30,format=yuv420p[v];[1:a]apad=pad_dur={tail}[a]")
(out / "fitted").mkdir(exist_ok=True)
dst = out / "fitted" / f"scene-{n}.mp4"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(clip), "-i", str(voice), "-filter_complex", graph,
                "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "16",
                "-c:a", "aac", "-b:a", "192k", "-shortest", str(dst)], check=True)
print(dst)
