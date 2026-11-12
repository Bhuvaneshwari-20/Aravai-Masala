import { useWindowDimensions } from 'react-native';

// One place that decides the layout: phone = compact + bottom tabs, tablet = roomy, web/desktop = sidebar + wide grids
export default function useLayout() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isPhone: width < 600,
    isWide: width >= 900,
    homeCols: width >= 1100 ? 4 : width >= 760 ? 3 : 2,
    listCols: width >= 1500 ? 3 : width >= 1000 ? 2 : 1,
  };
}
