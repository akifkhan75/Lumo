import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import styled from 'styled-components/native';

const Strip = styled(TouchableOpacity)`margin: 8px 16px; padding: 12px 16px; min-height: 48px; justify-content: center; border-radius: 12px; border-width: 2px; border-color: #1e3a8a; background-color: #eff6ff;`;
const Line = styled(Text)`font-size: 15px; font-weight: 700; color: #1e3a8a;`;
const Sub = styled(Text)`font-size: 13px; color: #1e3a8a; margin-top: 2px;`;

/**
 * Always visible while a link to the person's journey works (invariant 4). It is on the dashboard, not only inside the Journey screen,
 * because a person who has left that screen must still see that someone can look, and how to stop it. Nothing renders when none does.
 */
export default function SharingStrip({ count, onPress }: { count: number; onPress: () => void }) {
  if (count <= 0) return null;
  const what = count === 1 ? '1 link to your journey is on' : `${count} links to your journey are on`;
  return (
    <Strip onPress={onPress} accessibilityRole="button" accessibilityLiveRegion="polite" accessibilityLabel={`${what}. Open to see who could be looking and to turn them off`}>
      <Line>{what}</Line>
      <Sub>Anyone with a link can see it. Tap to review or stop.</Sub>
    </Strip>
  );
}
