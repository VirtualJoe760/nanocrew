// Expo Metro config + one override: force @google/genai to its WEB build.
// The package's node build does `require('ws')` for the Live API WebSocket, which doesn't exist in
// React Native — so the Live session silently hangs on connect. The web build uses the global
// WebSocket (provided by RN, and by Node 22 on Railway), so it works on both client and server.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const GENAI_WEB = path.resolve(__dirname, 'node_modules/@google/genai/dist/web/index.mjs');
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@google/genai') {
    return { type: 'sourceFile', filePath: GENAI_WEB };
  }
  return upstreamResolve
    ? upstreamResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
