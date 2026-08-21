import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

// OTA updates, applied without a second force-quit.
//
// expo-updates' default is launch-only and takes TWO launches to land a change: the first downloads
// it in the background, the second boots into it. With several updates stacked that becomes four or
// six relaunches, and a tester reasonably concludes the fix "didn't ship" (Joe, 2026-08-17 — the
// bigger wheel looked identical on his phone for exactly this reason).
//
// So: when a downloaded update is pending, reload into it as soon as doing so can't interrupt
// anything — on the next return from background. Never mid-session, because reloading under a
// creator's thumb would drop an interview transcript or a live voice turn.
export function UpdateGate() {
  const pending = useRef(false);

  useEffect(() => {
    // Disabled in dev: the bundle comes from Metro, and expo-updates isn't in play.
    if (__DEV__ || !Updates.isEnabled) return;

    let cancelled = false;

    // `coldStart` is the difference between a change landing in ONE launch and needing two. On a
    // cold start nothing is in progress — no transcript, no live turn — so reloading the moment the
    // download finishes is free. Later in the session we wait for a background/foreground hop.
    const check = async (coldStart = false) => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (cancelled || !result.isAvailable) return;
        await Updates.fetchUpdateAsync();
        if (cancelled) return;
        if (coldStart) {
          void Updates.reloadAsync().catch(() => {});
          return;
        }
        pending.current = true;
      } catch {
        // Offline, or the server is unreachable — the app keeps running on what it has. An update
        // that can't be fetched is never worth surfacing to a creator.
      }
    };

    void check(true); // launch: fetch and apply straight away

    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      // Coming back to the app is the safe moment: nothing is mid-gesture, mid-sentence or
      // mid-transcript, so a reload costs the creator nothing.
      if (pending.current) {
        pending.current = false;
        void Updates.reloadAsync().catch(() => {});
        return;
      }
      void check();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return null;
}
