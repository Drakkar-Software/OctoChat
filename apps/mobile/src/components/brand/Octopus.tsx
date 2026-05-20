import Svg, { Circle, Path } from 'react-native-svg';

import { useTheme } from '@/lib/use-theme';

interface OctopusProps {
  size?: number;
  /** Stroke color. Defaults to the marine accent. */
  color?: string;
}

/**
 * OctoChat brand mark — a single-stroke geometric octopus: round head, two
 * eyes, five tentacle arcs. Drawn on a 32×32 viewBox so it scales crisply at
 * any size on web and native.
 */
export function Octopus({ size = 28, color }: OctopusProps) {
  const { colors } = useTheme();
  const c = color ?? colors.accent;
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Circle cx={16} cy={13} r={9} stroke={c} strokeWidth={1.8} />
      <Circle cx={13} cy={12} r={1} fill={c} />
      <Circle cx={19} cy={12} r={1} fill={c} />
      <Path d="M7.5 18 Q6 23 9 26" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M11 21 Q10 26 13 27" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M16 22 Q16 27 16 28.5" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M21 21 Q22 26 19 27" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M24.5 18 Q26 23 23 26" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}
