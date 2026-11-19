import React from 'react';
import ProcessBoard from '../../components/ProcessBoard';

// Material-wise Grinding cards (Start / Stop). The old Add Entry form is no longer used.
export default function GrindingListScreen() {
  return <ProcessBoard type="GRINDING" path="grinding" module="grinding" title="Grinding" icon="mortar-pestle" />;
}