import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { GlowButton } from '@/components/glow-button';
import { GlowInput } from '@/components/glow-input';
import { withScreenFade } from '@/components/screen-fade';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { createSessionFromUrl } from '@/lib/oauth';
import { supabase } from '@/lib/supabase';

const DANGER = '#e24b4a';

// Where a password-reset email lands. The link bounces through Supabase and deep-links here with a
// one-time code/token; we turn that into a (recovery) session, then let the user set a new password
// via supabase.auth.updateUser. On web, supabase-js auto-detects the token in the URL
// (detectSessionInUrl); on native we hand the full URL — query OR hash params — to
// createSessionFromUrl ourselves, exactly like the OAuth callback.
function ResetPasswordScreen() {
  const theme = useTheme();
  const [phase, setPhase] = useState<'verifying' | 'ready' | 'invalid' | 'done'>('verifying');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Establish the recovery session from the link.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Already have a (recovery) session? Go straight to the form.
        const { data: existing } = await supabase.auth.getSession();
        if (existing.session) {
          if (!cancelled) setPhase('ready');
          return;
        }
        if (Platform.OS === 'web') {
          // detectSessionInUrl picks the token off the URL; give it a tick, then re-check.
          await new Promise((r) => setTimeout(r, 400));
          const { data } = await supabase.auth.getSession();
          if (!cancelled) setPhase(data.session ? 'ready' : 'invalid');
          return;
        }
        // Native: parse the deep link that opened us (params live in query or hash).
        const url = await Linking.getInitialURL();
        if (!url) {
          if (!cancelled) setPhase('invalid');
          return;
        }
        await createSessionFromUrl(url);
        if (!cancelled) setPhase('ready');
      } catch {
        if (!cancelled) setPhase('invalid');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async () => {
    if (busy) return;
    if (password.length < 6) {
      setError('Choose a password of at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The passwords don’t match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.wrap}>
        <ThemedText glow type="title" style={[styles.heading, { color: theme.text }]}>
          {phase === 'done' ? 'Password updated' : 'Set a new password'}
        </ThemedText>

        {phase === 'verifying' ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.tint} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              Verifying your reset link…
            </ThemedText>
          </View>
        ) : null}

        {phase === 'invalid' ? (
          <>
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              This reset link is invalid or has expired. Request a new one from the sign-in screen.
            </ThemedText>
            <GlowButton label="Back to sign in" onPress={() => router.replace('/account')} />
          </>
        ) : null}

        {phase === 'ready' ? (
          <>
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              Choose a new password for your account.
            </ThemedText>
            <GlowInput
              value={password}
              onChangeText={setPassword}
              placeholder="New password"
              secureTextEntry
              autoComplete="new-password"
              autoCapitalize="none"
            />
            <GlowInput
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Confirm new password"
              secureTextEntry
              autoComplete="new-password"
              autoCapitalize="none"
            />
            {error ? <ThemedText type="small" style={{ color: DANGER }}>{error}</ThemedText> : null}
            <GlowButton label="Update password" onPress={submit} loading={busy} />
          </>
        ) : null}

        {phase === 'done' ? (
          <>
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              Your password has been changed. You’re signed in.
            </ThemedText>
            <GlowButton label="Continue" onPress={() => router.replace('/account')} />
          </>
        ) : null}

        {phase === 'ready' || phase === 'invalid' ? (
          <Pressable onPress={() => router.replace('/account')} hitSlop={8} style={styles.cancel}>
            <ThemedText type="small" themeColor="textSecondary">Cancel</ThemedText>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  wrap: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.four, gap: Spacing.three, maxWidth: 460, width: '100%', alignSelf: 'center' },
  heading: { textAlign: 'center', marginBottom: Spacing.two },
  center: { alignItems: 'center', gap: Spacing.two },
  note: { textAlign: 'center', lineHeight: 20 },
  cancel: { alignSelf: 'center', paddingVertical: Spacing.two },
});

export default withScreenFade(ResetPasswordScreen, { background: true });
