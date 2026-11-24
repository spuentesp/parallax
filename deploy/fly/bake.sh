#!/usr/bin/env bash
# Publish each cluster's Lain startup checkpoint at image build time with `lain prewarm` (Lain >= 0.16.1).
# The next start (on Fly) then restores the graph instead of re-indexing for minutes, which would starve a
# 2-shared-CPU machine. prewarm fails the build, with the reason, if it cannot publish a checkpoint.
# It must run with the same paths the server will use (/repos/*.yaml, the data_dir inside them).
set -euo pipefail
lain prewarm --config /repos/repos-a.yaml
lain prewarm --config /repos/repos-b.yaml
echo "baked both clusters"
