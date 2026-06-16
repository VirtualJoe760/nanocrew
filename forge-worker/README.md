# nanocrew-forge-worker

A single persistent process on the **forge droplet** that drains the revision queue **one job at a
time**. The app API only *enqueues* (`store_revisions` row, `status='building'`, circled annotations
in `screenshots`); this worker runs each revision **locally** on the droplet, resolves the Vercel
preview, and writes back `ready`/`failed`.

Why: single worker + the global `~/stores/.forge.lock` ⇒ never two forge jobs at once (RAM-safe on the
960 MB box), and the 30-min build no longer depends on the app server staying alive (serverless-safe).

> ⚠️ The bash pipeline in `worker.mjs` mirrors `src/lib/revise.ts` (persistent clone + pnpm + render +
> global lock). Keep them in sync — same convention as the `platform-api/db/schema.ts` copy.

## Deploy (as the `forge` user, on the droplet)
```bash
# from your machine:
ssh nanocrew-forge 'mkdir -p /home/forge/forge-worker && chown forge:forge /home/forge/forge-worker'
scp forge-worker/worker.mjs forge-worker/package.json forge@<host>:/home/forge/forge-worker/

# install the Master CLAUDE.md that conditions the headless `claude` robot for EVERY job
# (build + revision). It's loaded as global user memory on top of each repo's @AGENTS.md.
ssh nanocrew-forge 'mkdir -p /home/forge/.claude'
scp forge-worker/forge-CLAUDE.md forge@<host>:/home/forge/.claude/CLAUDE.md

# on the droplet, as forge:
cd ~/forge-worker && npm i --omit=dev
# create ~/forge-worker/.env with:  DATABASE_URL, GITHUB_TOKEN, GITHUB_OWNER, VERCEL_TOKEN

# install the service (as root):
sudo cp nanocrew-forge-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nanocrew-forge-worker
sudo systemctl status nanocrew-forge-worker
journalctl -u nanocrew-forge-worker -f   # live logs
```

Env (`/home/forge/forge-worker/.env`, plain `KEY=VALUE`): `DATABASE_URL`, `GITHUB_TOKEN`,
`GITHUB_OWNER`, `VERCEL_TOKEN`.
