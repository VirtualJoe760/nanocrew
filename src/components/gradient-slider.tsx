import { useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// One draggable gradient bar. `stops` paints the spectrum; dragging maps the touch x → 0..1 → value.
// Shared by every hex picker (Studio mini-CMS site-editor + the brand-review screen).
export function GradientSlider({
  id,
  stops,
  value,
  onChange,
}: {
  id: string;
  stops: string[];
  value: number; // 0..1
  onChange: (t: number) => void;
}) {
  const [w, setW] = useState(0);
  const wRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  wRef.current = w;
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const width = wRef.current;
        if (width > 0) onChangeRef.current(Math.max(0, Math.min(1, e.nativeEvent.locationX / width)));
      },
      onPanResponderMove: (e) => {
        const width = wRef.current;
        if (width > 0) onChangeRef.current(Math.max(0, Math.min(1, e.nativeEvent.locationX / width)));
      },
    }),
  ).current;
  const thumbX = Math.max(0, Math.min(1, value)) * w;
  return (
    <View style={{ height: 26, justifyContent: 'center' }} onLayout={(e) => setW(e.nativeEvent.layout.width)} {...responder.panHandlers}>
      <Svg width="100%" height={22} style={{ borderRadius: 11 }}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            {stops.map((c, i) => (
              <Stop key={i} offset={stops.length === 1 ? 0 : i / (stops.length - 1)} stopColor={c} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height={22} rx={11} fill={`url(#${id})`} />
      </Svg>
      <View pointerEvents="none" style={{ position: 'absolute', left: thumbX - 9, width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#fff', backgroundColor: 'transparent', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }} />
    </View>
  );
}
