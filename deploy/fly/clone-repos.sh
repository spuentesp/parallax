#!/bin/sh
# Clone the six NVIDIA repos at pinned commits into /repos (used by Dockerfile.fly).
set -eu
mkdir -p /repos && cd /repos
export GIT_LFS_SKIP_SMUDGE=1
fetch() { # fetch <name> <sha>
  git init -q "$1" && cd "$1"
  git remote add origin "https://github.com/NVIDIA/$1.git"
  git fetch -q --depth 1 origin "$2"
  git checkout -q FETCH_HEAD
  rm -rf .git/objects/pack/*.keep
  cd ..
  echo "cloned $1 @ $2"
}
fetch OpenShell                    d4e32263eb4554c46c5bae702acada2f4af03eb0
fetch NemoClaw                     37f1e4cb9942a3dc05c0c76995f86624261bc7b1
fetch NeMo-Fabric                  4fdf65a4b4c96024327501ae28243f2d206e7ec7
fetch NeMo-Agent-Toolkit           3ec11d6f733f53ab0a0c3e7b3a7a3bb7cbf70db8
fetch NeMo-Agent-Toolkit-UI        41cb8cf843091a24bd06d0a5f844a3cb824049d8
fetch NeMo-Agent-Toolkit-Examples  eadbb7573b9ba12c01a9df85c601a32a886d7b25
