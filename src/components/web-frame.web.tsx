// Web-only storefront preview. react-native-webview has NO web build (it renders a
// "does not support this platform" stub and never fires onLoadEnd), which left the in-app site
// preview blank on web. This renders the live site in a real DOM <iframe> instead — the storefront
// sets no X-Frame-Options/CSP, so it embeds fine. Reload is a remount via `reloadKey`.
//
// `blocked` (the pen is armed) sets the iframe to pointer-events:none so the drawing overlay above
// it captures the WHOLE stroke — otherwise the iframe swallows the mouse mid-drag and nothing draws.
export function WebFrame({
  url,
  reloadKey,
  onLoad,
  blocked,
}: {
  url: string;
  reloadKey: number;
  onLoad: () => void;
  blocked?: boolean;
}) {
  return (
    <iframe
      key={reloadKey}
      src={url}
      onLoad={onLoad}
      title="Site preview"
      style={{
        border: 'none',
        width: '100%',
        height: '100%',
        background: '#fff',
        pointerEvents: blocked ? 'none' : 'auto',
      }}
    />
  );
}
