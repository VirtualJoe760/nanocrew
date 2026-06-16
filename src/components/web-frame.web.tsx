// Web-only storefront preview. react-native-webview has NO web build (it renders a
// "does not support this platform" stub and never fires onLoadEnd), which left the in-app site
// preview blank on web. This renders the live site in a real DOM <iframe> instead — the storefront
// sets no X-Frame-Options/CSP, so it embeds fine. Reload is a remount via `reloadKey`. The
// critique injection/hit-test is native-only (cross-origin iframe can't be scripted), so on web the
// circle tool falls back to positional labels — drawing still works (the overlay is a native View).
export function WebFrame({ url, reloadKey, onLoad }: { url: string; reloadKey: number; onLoad: () => void }) {
  return (
    <iframe
      key={reloadKey}
      src={url}
      onLoad={onLoad}
      title="Site preview"
      style={{ border: 'none', width: '100%', height: '100%', background: '#fff' }}
    />
  );
}
