#!/usr/bin/env bash
# Deploy the Nano Crew backend (Expo Router server routes) to Google Cloud Run.
#
# WHY THIS EXISTS: Railway's trial ended and took the backend offline, which broke the native
# app (EXPO_PUBLIC_API_URL pointed at it). Cloud Run is the free-tier replacement that still
# gives us a PERSISTENT NODE SERVER — required because src/lib/db.ts keeps a postgres-js TCP
# pool open against the Supabase transaction pooler (edge/Workers runtimes can't).
#
# It builds from source with Cloud Build (no local Docker needed), injects the three
# EXPO_PUBLIC_* values as BUILD args (they're inlined into the client bundle at export time),
# and uploads every other key from .env.local as RUNTIME env vars.
#
# Secrets never touch git or the image: they go into a 0600 temp YAML that is deleted on exit.
#
# Usage:
#   ./scripts/deploy-cloudrun.sh <gcp-project-id> [region] [service-name]
# Example:
#   ./scripts/deploy-cloudrun.sh nanocrew-api us-west1 backend

set -euo pipefail

PROJECT="${1:?Usage: deploy-cloudrun.sh <gcp-project-id> [region] [service]}"
REGION="${2:-us-west1}"
SERVICE="${3:-backend}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"
[ -f "$ENV_FILE" ] || { echo "✗ $ENV_FILE not found"; exit 1; }

# Temp env YAML — outside the repo, owner-read-only, always cleaned up.
ENV_YAML="$(mktemp -t nanocrew-env)"
chmod 600 "$ENV_YAML"
trap 'rm -f "$ENV_YAML"' EXIT

# .env.local → YAML. Skips comments/blank lines, strips surrounding quotes, and single-quotes
# the value for YAML (escaping any embedded single quotes) so commas/URLs/JSON survive intact.
# (--env-vars-file is used instead of --set-env-vars precisely because values contain commas.)
python3 - "$ENV_FILE" "$ENV_YAML" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
skip = {"PORT"}  # Cloud Run injects PORT itself
n = 0
with open(src) as f, open(dst, "w") as out:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        if not key.replace("_", "").isalnum() or key in skip:
            continue
        val = val.strip().strip('"').strip("'")
        out.write("%s: '%s'\n" % (key, val.replace("'", "''")))
        n += 1
print(f"  prepared {n} runtime env vars")
PY

# The 3 build-time values (inlined into the web bundle by `expo export`).
get() { grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"; }
API_URL="$(get EXPO_PUBLIC_API_URL)"
SB_URL="$(get EXPO_PUBLIC_SUPABASE_URL)"
SB_KEY="$(get EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"

echo "→ project=$PROJECT region=$REGION service=$SERVICE"
echo "→ EXPO_PUBLIC_API_URL (baked into bundle) = ${API_URL:-<unset>}"
echo "  NOTE: once Cloud Run gives you the final URL, set EXPO_PUBLIC_API_URL to it in"
echo "        .env.local and re-run, so the client bundle points at the right backend."

IMAGE="$REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/$SERVICE:latest"

# STEP 1 — build the image via cloudbuild.yaml so the EXPO_PUBLIC_* values reach Docker as real
# --build-arg values. (`gcloud run deploy --source` does NOT forward them, which left the ARGs
# empty and broke `expo export` with "supabaseUrl is required".)
echo "→ [1/2] building image…"
gcloud builds submit "$REPO_ROOT" \
  --project="$PROJECT" \
  --region="$REGION" \
  --config="$REPO_ROOT/cloudbuild.yaml" \
  --substitutions="_IMAGE=$IMAGE,_EXPO_PUBLIC_API_URL=$API_URL,_EXPO_PUBLIC_SUPABASE_URL=$SB_URL,_EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$SB_KEY"

# STEP 2 — deploy that image with the 53 runtime secrets.
echo "→ [2/2] deploying to Cloud Run…"
gcloud run deploy "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --allow-unauthenticated \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --min-instances=0 \
  --max-instances=3 \
  --env-vars-file="$ENV_YAML"

echo
echo "✓ deployed. Service URL:"
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.url)'
