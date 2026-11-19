import React from 'react';
import ProcessBoard from '../../components/ProcessBoard';

// Material-wise Filtering cards (Start / Stop / Proceed to Roasting). The old Add-entry form is no longer used.
export default function FilteringListScreen() {
  return <ProcessBoard type="FILTERING" path="filtering" module="filtering" title="Filtering" icon="filter-variant" />;
}