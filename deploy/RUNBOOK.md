# Deploying the Parallax demo (Nebius VM)

Goal: a public, **locked** demo. Visitors see only an access-token screen; judges get a link that signs them in with a **read-only** token. Everything runs on one VM: Lain (analysis engine) on the host, Parallax + HTTPS (Caddy) in Docker.

> Tested locally (no Docker available in the dev environment): Lain 0.13.0 cold index of Saleor, the API + built web bundle against it, token generation, the sign-in link and read-only behaviour. **Not tested:** the Docker image and compose file themselves — do a dry run on the VM before the deadline.

## 0. What you need
- A VM (Nebius AI Cloud, Ubuntu 22.04+, ~4 vCPU / 8 GB / 40 GB disk) with a public IP and ports 80/443 open.
- A DNS name pointing at it (Caddy gets the certificate automatically). If you only have an IP, use a `nip.io` name such as `1-2-3-4.nip.io`.
- A Nebius Token Factory key (`NEBIUS_TOKEN`).

## 1. Install Docker and Git
```bash
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER && newgrp docker
```

## 2. Lain 0.13.0 on the host
```bash
mkdir -p ~/lain && cd ~/lain
gh release download v0.13.0 -R spuentesp/lain -p 'lain-0.13.0-x86_64-unknown-linux-gnu.tar.gz' -p SHA256SUMS
grep x86_64-unknown-linux-gnu.tar.gz$ SHA256SUMS | sha256sum -c - && tar xzf lain-0.13.0-x86_64-unknown-linux-gnu.tar.gz
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
Run it so it survives reboots (systemd or `tmux`), listening on **localhost only**:
```bash
~/lain/lain server --config ~/saleor/repos.yaml --transport http --port 9999
```
A cold index of this workspace took **111 s** on a dev machine. Wait until it finishes before seeding.

## 3. Configure Parallax
```bash
git clone https://github.com/spuentesp/parallax.git && cd parallax/deploy
cp .env.demo.example .env
node gen-tokens.mjs https://YOUR.DOMAIN ws_saleor     # prints PARALLAX_TOKENS and two links
```
Paste the `PARALLAX_TOKENS=...` line, your `DOMAIN` and `NEBIUS_TOKEN` into `.env`. Keep the **admin link** private. The **judges link** (read-only) goes in the Devpost testing instructions.

## 4. Start
```bash
docker compose up -d --build
```

## 5. Seed the workspace
The Saleor workspace must exist in the database, pointing at Lain:
```bash
docker compose exec -e SALEOR_LAIN_URL=http://host.docker.internal:9999/mcp parallax \
  pnpm --filter @parallax/api exec tsx scripts/seed-workspaces.ts
```
(The seed script also creates the Online Boutique and Contracts Fixture workspaces; they will show "LAIN error" unless you run Lain for them too — delete them or ignore.)

## 6. Verify (do this before submitting)
- `https://YOUR.DOMAIN/orgs/ws_saleor` with no token → the access screen, nothing else.
- The judges link → opens the Saleor map, shows "Read-only access", Refresh is disabled.
- Open **Ask the architecture**, ask *"Which services consume the checkout API?"* → an answer with "N verified", **not** `failed:no_model_configured` (that means `NEBIUS_TOKEN` is missing or wrong).
- `curl -s https://YOUR.DOMAIN/api/health` → `"lainAdapter":"real"`.

## Rules reminders (Devpost)
- The demo must stay up and free to use **until Dec 15, 2026** (end of judging).
- Put the read-only link in the testing instructions, not in the repo.
- `QUERY_RATE_LIMIT_PER_HOUR` caps questions per token so a shared link cannot drain your Token Factory credits.


## Check that progress streams live (not all at the end)

The assistant streams what it is doing over server-sent events. A proxy that buffers or
compresses would deliver every step at the end. Through the real domain:

```bash
curl -N -sS -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"question":"Who consumes saleor-api?","orgId":"ws_saleor"}' \
  https://YOUR.DOMAIN/api/query/stream
```

You should see `event: progress` blocks appear one by one over several seconds, then one
`event: result`. If everything arrives at once, check that the Caddyfile still has
`flush_interval -1` and the `@notsse` encode matcher. A question can take up to ~3 minutes:
no proxy in front may time out before that.
