import { useWindowDimensions } from 'react-native';

export const SIDEBAR_W = 264;

// One place that decides the layout:
// phone (<600) = compact + bottom tabs | tablet (600-899) = roomy + bottom tabs | desktop/web (>=900) = sidebar + wide grids
export default function useLayout() {
  const { width, height } = useWindowDimensions();
  const isWide = width >= 900;
  const isPhone = width < 600;
  return {
    width,
    height,
    isPhone,
    isTiny: width < 360,
    isTablet: !isPhone && !isWide,
    isWide,
    pad: isWide ? 28 : isPhone ? 14 : 20,
    contentWidth: width - (isWide ? SIDEBAR_W : 0),
    homeCols: width >= 1100 ? 4 : width >= 760 ? 3 : 2,
    listCols: width >= 1500 ? 3 : width >= 720 ? 2 : 1,
  };
}
