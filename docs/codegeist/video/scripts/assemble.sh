#!/usr/bin/env bash
# Join the fitted scenes into the final video: out/parallax-codegeist-1080p.mp4
#   assemble.sh            (scenes 1-7, in order)
set -euo pipefail
out="$(cd "$(dirname "$0")/.." && pwd)/out"
list="$out/fitted/concat.txt"
: > "$list"
for n in 1 2 3 4 5 6 7; do echo "file '$out/fitted/scene-$n.mp4'" >> "$list"; done
joined="$out/fitted/joined.mp4"
ffmpeg -v error -y -f concat -safe 0 -i "$list" -c:v libx264 -preset slow -crf 16 -c:a aac -b:a 192k "$joined"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$joined")
fade_out=$(python3 -c "print(max(0, $dur - 0.8))")
ffmpeg -v error -y -i "$joined" \
  -vf "fade=t=in:st=0:d=0.5,fade=t=out:st=$fade_out:d=0.8" \
  -af "afade=t=in:st=0:d=0.3,afade=t=out:st=$fade_out:d=0.8" \
  -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart \
  "$out/parallax-codegeist-1080p.mp4"
echo "$out/parallax-codegeist-1080p.mp4 ($(python3 -c "d=$dur; print(f'{int(d//60)}:{d%60:04.1f}')"))"
