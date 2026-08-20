import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

// One door for "give me a picture" (Joe, 2026-08-20): the camera or the photo library — the
// caller doesn't care which. Returns a data URL ready to ride /api/generate's `image` reference.
// Used by BOTH design surfaces (docs/studio/DESIGN_SURFACES.md) — the tab's Upload tile and
// Eve's "Add a photo" — so inspiration photos and, later, avatar selfies share one path.

export type PhotoSource = 'camera' | 'library';

export async function pickPhoto(source: PhotoSource): Promise<string | null> {
  try {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const opts = { mediaTypes: ['images'], base64: true, quality: 0.9 } satisfies ImagePicker.ImagePickerOptions;
    const res =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return null;
    const a = res.assets[0];
    return a.base64 ? `data:${a.mimeType ?? 'image/jpeg'};base64,${a.base64}` : null;
  } catch {
    // No camera on this device/simulator, or the picker failed — never crash a design flow.
    return null;
  }
}

/** Camera-or-library via a native sheet, then pick. Resolves null on cancel or denial. */
export function choosePhoto(): Promise<string | null> {
  return new Promise((resolve) => {
    Alert.alert('Add a photo', undefined, [
      { text: 'Take a photo', onPress: () => void pickPhoto('camera').then(resolve) },
      { text: 'Choose from Photos', onPress: () => void pickPhoto('library').then(resolve) },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}
