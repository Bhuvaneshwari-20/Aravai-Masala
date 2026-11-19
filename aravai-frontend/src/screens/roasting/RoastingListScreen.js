import React from 'react';
import ProcessBoard from '../../components/ProcessBoard';

// Material-wise Roasting cards (Start / Stop). The old Add Entry form is no longer used.
export default function RoastingListScreen() {
  return <ProcessBoard type="ROASTING" path="roasting" module="roasting" title="Roasting" icon="fire" />;
}