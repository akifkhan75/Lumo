import React from 'react';
import { View, Text } from 'react-native';
import styled from 'styled-components/native';

/**
 * Marks a screen whose behaviour is not real yet.
 *
 * Lumo's first invariant is that the product never implies help is coming
 * when it is not. Today every trigger works — button, shake, voice, impact —
 * and the entire response chain behind them is a mock: no contact is
 * messaged, no location is shared, nothing is recorded. Until that chain
 * exists, a screen that behaves like a demo has to say so where the user
 * looks, not in a changelog.
 *
 * This banner is removed screen by screen as each capability becomes real.
 * It is not a design flourish and should not be made subtler.
 */

const Banner = styled(View)`
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
  background-color: #fef3c7; /* amber-100 */
  border-left-width: 4px;
  border-left-color: #d97706; /* amber-600 */
  border-radius: 8px;
  padding: 12px;
`;

const Label = styled(Text)`
  color: #92400e; /* amber-800 */
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.5px;
`;

const Body = styled(Text)`
  color: #78350f; /* amber-900 */
  font-size: 13px;
  line-height: 18px;
`;

const TextColumn = styled(View)`
  flex: 1;
  gap: 2px;
`;

export const DemoBanner = ({ children }: { children: React.ReactNode }) => (
  <Banner
    accessible
    accessibilityRole="alert"
    accessibilityLabel={`Demonstration only. ${typeof children === 'string' ? children : ''}`}
  >
    <TextColumn>
      <Label>DEMONSTRATION ONLY</Label>
      <Body>{children}</Body>
    </TextColumn>
  </Banner>
);

export default DemoBanner;
