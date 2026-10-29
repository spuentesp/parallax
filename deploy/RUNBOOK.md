# Deploying the Parallax demo (Nebius VM)

Goal: a public, **protected** demo on Nebius AI Cloud showcasing two distinct NVIDIA agent architecture workspaces:
- **Cluster A (`ws_cluster_a`)**: OpenShell gRPC proto surface + Python SDK client + NeMo-Fabric / NemoClaw cross-repo consumers.
- **Cluster B (`ws_cluster_b`)**: NeMo Agent Toolkit HTTP & WebSocket runtime endpoints + Next.js API routes + UI reverse proxy.

Everything runs on one VM:
- Two Lain instances on the host (Cluster A on port 9991, Cluster B on port 9992).
- Parallax + automatic HTTPS (Caddy) in Docker.

## 0. What you need
- A VM (Nebius AI Cloud, Ubuntu 22.04+, ~4 vCPU / 8 GB / 50 GB disk) with a public IP and ports 80/443 open.
- A DNS name pointing at it (Caddy gets Let's Encrypt certificates automatically; e.g. `<IP>.nip.io`).
- A Nebius Token Factory key (`NEBIUS_TOKEN`).

## 1. Install Docker and Git
```bash
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER && newgrp docker
```

## 2. Compile latest Lain dev build & clone NVIDIA repos

Lain runs directly on the host VM for optimal indexing performance.

### Step 2.1: Compile the preview `dev` branch tip of Lain
Compiles the latest commit from `spuentesp/lain` on branch `dev` (includes commit `c567612` with OpenShell gRPC surface and NeMo Agent Toolkit HTTP contract detection):
```bash
git clone https://github.com/spuentesp/parallax.git && cd parallax
./deploy/build-lain.sh dev ~/lain
```

### Step 2.2: Clone the 6 NVIDIA repositories
```bash
./deploy/clone-nvidia-repos.sh ~/nvidia
```

### Step 2.3: Start both Lain clusters
Starts Cluster A on port `9991` and Cluster B on port `9992`:
```bash
./deploy/start-lain-clusters.sh ~/lain/lain
```
Wait for both clusters to finish their initial indexing passes (check logs at `/tmp/lain-cluster-a.log` and `/tmp/lain-cluster-b.log`).

## 3. Configure Parallax & Generate Tokens
```bash
cd ~/parallax/deploy
cp .env.demo.example .env

# Generate the two demo tokens (looking & judges) for both clusters
node gen-tokens.mjs https://YOUR.DOMAIN
```
This prints:
1. `PARALLAX_TOKENS='...'` — paste into `deploy/.env`.
2. **Cluster A Links**:
   - Looking (read-only): `https://YOUR.DOMAIN/orgs/ws_cluster_a?token=px_look_...`
   - Judges (testing): `https://YOUR.DOMAIN/orgs/ws_cluster_a?token=px_judge_...`
3. **Cluster B Links**:
   - Looking (read-only): `https://YOUR.DOMAIN/orgs/ws_cluster_b?token=px_look_...`
   - Judges (testing): `https://YOUR.DOMAIN/orgs/ws_cluster_b?token=px_judge_...`

Also fill in `DOMAIN` and `NEBIUS_TOKEN` in `deploy/.env`.

## 4. Build and Start Docker Containers
```bash
docker compose up -d --build
```
`docker-compose.yml` automatically verifies container health before routing traffic via Caddy.

## 5. Seed the two workspaces
Seed both `ws_cluster_a` and `ws_cluster_b` in the database:
```bash
docker compose exec parallax \
  pnpm --filter @parallax/api exec tsx scripts/seed-workspaces.ts
```

## 6. Verify (automated & manual)

### Automated check:
```bash
./verify-deployment.sh
```

### Manual checks:
- `https://YOUR.DOMAIN/orgs/ws_cluster_a` without token → access screen prompting for token.
- **Cluster A Judges link** → opens OpenShell & NeMo-Fabric architecture map. Ask: *"Which services consume the OpenShell gRPC API?"*
- **Cluster B Judges link** → opens NeMo Agent Toolkit map. Ask: *"Who dials the NAT backend endpoints?"*
- `curl -s https://YOUR.DOMAIN/api/health` → `"status":"ok"` and `"lainAdapter":"real"`.

## Live progress streaming verification
Verify SSE streaming isn't buffered through Caddy:
```bash
curl -N -sS -H "Authorization: Bearer $JUDGE_TOKEN" -H 'content-type: application/json' \
  -d '{"question":"Which services call OpenShell?","orgId":"ws_cluster_a"}' \
  https://YOUR.DOMAIN/api/query/stream
```
You should see `event: progress` blocks stream in live over several seconds, followed by `event: result`.
