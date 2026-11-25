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

# The commits of the pull requests that Parallax has analysed for the demo. The engine reads a pull
# request's base and head from branches of these checkouts, so re-running one of those analyses
# (or a new one on top of them) needs them to exist. The SHAs come from each stored report's
# manifest (manifest.base.repos / manifest.head.repos). Stored reports themselves live on the
# /data volume and do not depend on this.
branch() { # branch <repo> <branch> <sha> <remote-url>
  cd "/repos/$1"
  git fetch -q --depth 1 "$4" "$3"
  git branch -f "$2" "$3"
  cd ..
  echo "branch $1:$2 @ $3"
}
branch OpenShell parallax-pr-5052-base   d7b616895d8778320f994ddf14f4e89ab777f29c https://github.com/NVIDIA/OpenShell.git
branch OpenShell parallax-pr-5052-head   3e2dfab579465726d928f2a1d318c953efd9eca4 https://github.com/NVIDIA/OpenShell.git
branch NemoClaw  parallax-pr-13812-head  1f890f6073e19c40a3a52be59e40c6a6e51bf2b3 https://github.com/NVIDIA/NemoClaw.git
# Synthetic demo pull requests on a fork (spuentesp/openshell #1 and #2); their base is the pinned commit.
branch OpenShell parallax-pr-demo-1-head d3bef6d435d14829c38d77252c473e8ae0759f6e https://github.com/spuentesp/openshell.git
branch OpenShell parallax-pr-demo-2-head a5ec25f9ab7f35d3fea1020c0505e883dde2fa07 https://github.com/spuentesp/openshell.git
