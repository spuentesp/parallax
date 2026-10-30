#!/usr/bin/env python3
"""
Generates the dual-voice audio narration for the Parallax hackathon pitch video.
- Junior Engineer (Brian): Relatable dev onboarding hook & prompt question.
- Lead Architect (Ava): Primary narrator and technical guide across the investigation,
  map canvas, PR safety, and system architecture.
"""

import asyncio
import json
import os
import subprocess
from pathlib import Path
import edge_tts

OUTPUT_DIR = Path("docs/hackathon/video/audio")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

VOICES = {
    "junior": "en-US-BrianNeural",
    "architect": "en-US-AvaNeural"
}

SCENES = [
    {
        "id": "scene_1_1",
        "speaker": "junior",
        "text": "I just joined an AI agent platform team working on NVIDIA's OpenShell and NeMo stack. I don't know the service mesh, which repos matter, or what depends on what.",
        "pause_after": 0.4
    },
    {
        "id": "scene_1_2",
        "speaker": "architect",
        "text": "Normally, that's two weeks of bugging seniors. And at architect scale, it's an undocumented cross-repo mesh. Parallax turns that tribal knowledge into an explorable reality.",
        "pause_after": 1.2
    },
    {
        "id": "scene_2_1",
        "speaker": "junior",
        "text": "So I ask Parallax: Trace the call stack from our database ORM table up to the client endpoint consuming it.",
        "pause_after": 10.0 # Time for typing on screen and Nemotron investigating
    },
    {
        "id": "scene_2_2",
        "speaker": "architect",
        "text": "Watch Nemotron investigate using the code analysis engine's tools. Look at the result: every relationship it claims was checked by the engine. Verified. Contradicted. Unverifiable. The model doesn't decide what's true; the engine does.",
        "pause_after": 2.5 # Time to highlight verification badges
    },
    {
        "id": "scene_2_3",
        "speaker": "architect",
        "text": "Click Show on map, and it takes us directly to the architecture backing the answer.",
        "pause_after": 3.0 # Camera panning to subgraph
    },
    {
        "id": "scene_3_1",
        "speaker": "architect",
        "text": "Now I want the whole picture. Repos, services, endpoints, down to the actual functions. Everything is loaded on demand, so even massive monorepos scale smoothly.",
        "pause_after": 4.0 # Time to drill down in Cytoscape
    },
    {
        "id": "scene_3_2",
        "speaker": "architect",
        "text": "Solid lines are proven by static analysis. Dashed lines are inferred, fainter the less sure the engine is. Parallax never promotes a guess to a fact.",
        "pause_after": 3.0 # Filter toggling
    },
    {
        "id": "scene_3_3",
        "speaker": "architect",
        "text": "Click any endpoint to see who consumes it across repos, and how confident we are.",
        "pause_after": 4.0 # Endpoint inspector drawer
    },
    {
        "id": "scene_4_1",
        "speaker": "architect",
        "text": "Before code ships: what does this pull request break downstream? The engine determines the blast radius and severity, while Nemotron explains the impact finding by finding—no invented regressions, zero hallucinations.",
        "pause_after": 5.0 # Exploring PR impact drawer / findings
    },
    {
        "id": "scene_5_1",
        "speaker": "architect",
        "text": "Under the hood: Nemotron Super plans the investigation and Lightning handles fast tool execution through Nebius Token Factory. Every tool call and prompt version is saved to the audit log. The entire platform runs on Nebius.",
        "pause_after": 4.0 # Inspecting audit log & trace
    },
    {
        "id": "scene_6_1",
        "speaker": "architect",
        "text": "Knowledge locked in people's heads, made navigable and verifiable. That's Parallax: if it's in your org's code, it can guide you.",
        "pause_after": 3.0 # End card with repository and demo URLs
    }
]

def get_audio_duration(file_path: Path) -> float:
    cmd = [
        "ffprobe", "-i", str(file_path),
        "-show_entries", "format=duration",
        "-v", "quiet", "-of", "csv=p=0"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return float(res.stdout.strip())

async def generate_segment(segment):
    file_path = OUTPUT_DIR / f"{segment['id']}.mp3"
    voice = VOICES[segment["speaker"]]
    communicate = edge_tts.Communicate(segment["text"], voice)
    await communicate.save(str(file_path))
    duration = get_audio_duration(file_path)
    return {
        **segment,
        "audio_file": str(file_path),
        "duration": duration
    }

async def main():
    print("🎙️ Generating streamlined voiceover with edge-tts...")
    generated = []
    for s in SCENES:
        print(f"Generating [{s['speaker'].upper()}] {s['id']}...")
        item = await generate_segment(s)
        generated.append(item)

    # Build timeline cues
    timeline = []
    current_time = 0.0

    concat_list_path = OUTPUT_DIR / "concat_list.txt"
    with open(concat_list_path, "w") as f:
        for item in generated:
            cue = {
                "id": item["id"],
                "speaker": item["speaker"],
                "text": item["text"],
                "start_time": round(current_time, 3),
                "duration": round(item["duration"], 3),
                "pause_after": item["pause_after"],
                "end_time": round(current_time + item["duration"], 3),
            }
            timeline.append(cue)
            
            f.write(f"file '{Path(item['audio_file']).resolve()}'\n")
            current_time += item["duration"]

            if item["pause_after"] > 0:
                silence_file = OUTPUT_DIR / f"silence_{item['id']}.mp3"
                subprocess.run([
                    "ffmpeg", "-y", "-f", "lavfi", "-i",
                    "anullsrc=r=24000:cl=mono", "-t", str(item["pause_after"]),
                    "-q:a", "9", "-acodec", "libmp3lame", str(silence_file)
                ], capture_output=True, check=True)
                f.write(f"file '{silence_file.resolve()}'\n")
                current_time += item["pause_after"]

    # Concat master audio track
    master_audio = OUTPUT_DIR / "master_voiceover.mp3"
    print("🎛️ Stitching master audio track...")
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(concat_list_path), "-c", "copy", str(master_audio)
    ], capture_output=True, check=True)

    total_duration = get_audio_duration(master_audio)
    minutes = int(total_duration // 60)
    seconds = int(total_duration % 60)
    print(f"✅ Streamlined voiceover complete: {master_audio} ({minutes}:{seconds:02d} / {total_duration:.2f}s)")

    # Save JSON timeline
    timeline_file = Path("docs/hackathon/video/audio-timeline.json")
    with open(timeline_file, "w") as f:
        json.dump({
            "total_duration": round(total_duration, 2),
            "cues": timeline
        }, f, indent=2)
    print(f"📄 Saved timeline manifest: {timeline_file}")

if __name__ == "__main__":
    asyncio.run(main())
