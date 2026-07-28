# Container for the Nano Crew backend (Expo Router server routes, src/app/**+api.ts).
#
# Deliberately mirrors what Railway ran — `expo export -p web` then `expo serve` — so the
# deploy stays HOST-PORTABLE: this image runs on Cloud Run, Render, Koyeb, Fly, or any Node
# container host. Nothing here is Google-specific.
#
# A persistent Node server (not an edge/Workers runtime) is REQUIRED: src/lib/db.ts holds a
# postgres-js TCP pool against the Supabase transaction pooler, which Cloudflare Workers /
# EAS Hosting cannot keep alive between requests.

FROM node:22-slim

WORKDIR /app

# Deps first so this layer stays cached until the lockfile actually changes.
# .npmrc is REQUIRED here: it carries `legacy-peer-deps=true`, without which `npm ci` fails on
# the react-native-audio-api ↔ react-native-worklets peer conflict (the same setting makes the
# install work locally).
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# EXPO_PUBLIC_* are INLINED INTO THE CLIENT BUNDLE AT EXPORT TIME — they must be present
# during the build, not just at runtime. Pass them with --build-arg (see DEPLOY_CLOUD_RUN.md).
# Every OTHER secret (Stripe, Supabase service key, Gemini, …) is runtime-only and must be set
# as a Cloud Run env var — never baked into the image.
ARG EXPO_PUBLIC_API_URL
ARG EXPO_PUBLIC_SUPABASE_URL
ARG EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL \
    EXPO_PUBLIC_SUPABASE_URL=$EXPO_PUBLIC_SUPABASE_URL \
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY

COPY . .
RUN npx expo export -p web

# Cloud Run injects $PORT (8080 by default). Shell form so $PORT expands at runtime.
ENV PORT=8080
EXPOSE 8080
CMD npx expo serve --port $PORT
