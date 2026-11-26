#!/usr/bin/env bash
set -euo pipefail

# Parallax Video Pitch Builder
# Merges Playwright screen recording with the dual-voice narration audio track.

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

OUTPUT_DIR="docs/hackathon/video/output"
mkdir -p "$OUTPUT_DIR"

VIDEO_RAW="${1:-docs/hackathon/video/recordings/raw-demo.webm}"
AUDIO_MASTER="docs/hackathon/video/audio/master_voiceover.mp3"
FINAL_OUTPUT="$OUTPUT_DIR/parallax-pitch-1080p.mp4"

if [ ! -f "$AUDIO_MASTER" ]; then
  echo "❌ Error: Master audio file not found at $AUDIO_MASTER"
  echo "Run 'python3 docs/hackathon/video/scripts/generate-voiceover.py' first."
  exit 1
fi

if [ ! -f "$VIDEO_RAW" ]; then
  echo "❌ Error: Screen recording not found at $VIDEO_RAW"
  echo "Usage: ./docs/hackathon/video/scripts/build-video.sh [path-to-screen-recording.webm]"
  exit 1
fi

echo "🎬 Stitching final pitch video..."
echo "Video input: $VIDEO_RAW"
echo "Audio input: $AUDIO_MASTER"
echo "Output:      $FINAL_OUTPUT"

ffmpeg -y -i "$VIDEO_RAW" -i "$AUDIO_MASTER" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  -shortest \
  "$FINAL_OUTPUT"

echo "✅ Success! Final video generated at: $FINAL_OUTPUT"
