import { useWindowDimensions } from 'react-native';

// One place that decides how many columns to show: phone = compact, web/desktop = wider grids
export default function useLayout() {
  const { width } = useWindowDimensions();
  return {
    width,
    homeCols: width >= 1100 ? 4 : width >= 760 ? 3 : 2,
    listCols: width >= 1500 ? 3 : width >= 1000 ? 2 : 1,
    isWide: width >= 900,
  };
}
