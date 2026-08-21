import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { registerForPush } from '@/lib/push';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .finally(() => setLoading(false));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Once signed in, register this device for push (best-effort; no-op on web / Expo Go).
  useEffect(() => {
    if (session?.access_token) void registerForPush(session.access_token);
  }, [session?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { session, loading };
}
