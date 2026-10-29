# Deploying the Parallax demo (Nebius VM)

Goal: a public, **protected** demo on Nebius AI Cloud.
- Visitors without a token see only an access-token screen.
- Visitors with the **looking** token get read-only exploration access.
- Judges with the **judges** token get testing privileges (Ask the architecture, PR evaluations, and interactive features).
Everything runs on one VM: Lain (analysis engine) runs on the host, Parallax + HTTPS (Caddy) runs in Docker.

## 0. What you need
- A VM (Nebius AI Cloud, Ubuntu 22.04+, ~4 vCPU / 8 GB / 40 GB disk) with a public IP and ports 80/443 open.
- A DNS name pointing at it (Caddy gets the Let's Encrypt certificate automatically). If you only have an IP, use a `nip.io` name such as `1-2-3-4.nip.io`.
- A Nebius Token Factory key (`NEBIUS_TOKEN`).

## 1. Install Docker and Git
```bash
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER && newgrp docker
```

## 2. Lain on the host (compile preview dev branch or install release)

Lain runs directly on the host VM for optimal indexing performance.

### Option A: Compile from the preview `dev` branch tip (Recommended for preview features)
Compiles the latest commit from `spuentesp/lain` on branch `dev` (automatically handles Rust toolchain and build dependencies):
```bash
# Clone Parallax if needed
git clone https://github.com/spuentesp/parallax.git && cd parallax

# Compile the preview dev branch tip to ~/lain/lain
./deploy/build-lain.sh dev ~/lain
```

### Option B: Download the latest prebuilt release binary
If you prefer to use a tagged GitHub release binary:
```bash
./deploy/install-lain.sh ~/lain
```

Clone the repos to analyse and describe them in `repos.yaml` (Saleor example):
```bash
mkdir -p ~/saleor && cd ~/saleor
git clone --depth 1 https://github.com/saleor/saleor.git
git clone --depth 1 https://github.com/saleor/saleor-dashboard.git
git clone --depth 1 https://github.com/saleor/storefront.git

cat > repos.yaml <<'YAML'
data_dir: /home/ubuntu/saleor/.lain/federation
repos:
  - id: saleor
    source: {type: workspace_dir, path: /home/ubuntu/saleor/saleor}
  - id: saleor-dashboard
    source: {type: workspace_dir, path: /home/ubuntu/saleor/saleor-dashboard}
  - id: storefront
    source: {type: workspace_dir, path: /home/ubuntu/saleor/storefront}
services:
  - name: saleor-api
    repo: saleor
    env: [NEXT_PUBLIC_SALEOR_API_URL]
  - name: saleor-dashboard
    repo: saleor-dashboard
    provides_graphql: false
  - name: saleor-storefront
    repo: storefront
YAML
```

Run Lain listening on **localhost only** (survives in tmux or systemd):
```bash
~/lain/lain server --config ~/saleor/repos.yaml --transport http --port 9999
```
A cold index of this workspace takes ~2 minutes. Wait until indexing completes before seeding Parallax.

## 3. Configure Parallax & Generate Tokens
```bash
cd ~/parallax/deploy
cp .env.demo.example .env

# Generate the two demo tokens (looking & judges)
node gen-tokens.mjs https://YOUR.DOMAIN ws_saleor
```
This prints:
1. `PARALLAX_TOKENS='...'` — paste into `deploy/.env`.
2. **Just for Looking link** (`?token=px_look_...`): Read-only access for general inspection.
3. **For Judges to Test link** (`?token=px_judge_...`): Testing access to put in the Devpost submission.
4. **Maintainer link** (`?token=px_admin_...`): Keep private.

Also set `DOMAIN` and `NEBIUS_TOKEN` in `deploy/.env`.

## 4. Build and Start Docker Containers
```bash
docker compose up -d --build
```
`docker-compose.yml` automatically verifies container health before routing traffic via Caddy.

## 5. Seed the workspace
The Saleor workspace must exist in the database, pointing at host Lain:
```bash
docker compose exec -e SALEOR_LAIN_URL=http://host.docker.internal:9999/mcp parallax \
  pnpm --filter @parallax/api exec tsx scripts/seed-workspaces.ts
```

## 6. Verify (automated & manual)

### Automated check:
```bash
./verify-deployment.sh
```

### Manual checks:
- `https://YOUR.DOMAIN/orgs/ws_saleor` with no token → access screen prompting for token.
- The **Looking link** → opens Saleor map in read-only mode (`[read-only]` badge).
- The **Judges link** → opens Saleor map with testing access enabled.
- Open **Ask the architecture**, ask *"Which services consume the checkout API?"* → answer with verified claims from Nemotron over Nebius Token Factory.
- `curl -s https://YOUR.DOMAIN/api/health` → `"status":"ok"` and `"lainAdapter":"real"`.

## Rules reminders (Devpost)
- The demo must stay up and accessible **until Dec 15, 2026** (end of judging).
- Put the judges link in the testing instructions of Devpost.
- `QUERY_RATE_LIMIT_PER_HOUR` protects against credit exhaustion.

## Live progress streaming verification
Verify SSE streaming isn't buffered through Caddy:
```bash
curl -N -sS -H "Authorization: Bearer $JUDGE_TOKEN" -H 'content-type: application/json' \
  -d '{"question":"Who consumes saleor-api?","orgId":"ws_saleor"}' \
  https://YOUR.DOMAIN/api/query/stream
```
You should see `event: progress` blocks stream in live over several seconds, followed by `event: result`.
