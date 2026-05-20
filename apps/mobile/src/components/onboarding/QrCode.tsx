import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import QRCode from 'react-native-qrcode-svg';

import { radii } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Octopus } from '@/components/brand/Octopus';

const N = 23;

/** Deterministic faux-QR matrix used only when no real `value` is provided. */
function makeMatrix(seed: number): boolean[][] {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const grid: boolean[][] = Array.from({ length: N }, () =>
    Array.from({ length: N }, () => rand() > 0.52),
  );
  const finder = (or: number, oc: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const border = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[or + r]![oc + c] = border || core;
      }
    }
  };
  finder(0, 0);
  finder(0, N - 7);
  finder(N - 7, 0);
  const cs = Math.floor(N / 2) - 2;
  for (let r = cs; r < cs + 5; r++) {
    for (let c = cs; c < cs + 5; c++) grid[r]![c] = false;
  }
  return grid;
}

/**
 * QR with the octopus mark at its center. When `value` is given it renders a
 * REAL scannable code (react-native-qrcode-svg); otherwise a decorative matrix.
 */
export function QrCode({ size = 200, value }: { size?: number; value?: string }) {
  const { colors } = useTheme();
  const grid = useMemo(() => makeMatrix(1337), []);
  const m = size / N;
  const logo = size * 0.22;

  return (
    <View style={[styles.wrap, { width: size, height: size, backgroundColor: colors.paper, borderColor: colors.accent }]}>
      {value ? (
        <QRCode value={value} size={size - 22} color={colors.ink} backgroundColor={colors.paper} ecl="M" />
      ) : (
        <Svg width={size} height={size}>
          {grid.flatMap((row, r) =>
            row.map((on, c) =>
              on ? (
                <Rect key={`${r}-${c}`} x={c * m} y={r * m} width={m + 0.4} height={m + 0.4} rx={m * 0.2} fill={colors.ink} />
              ) : null,
            ),
          )}
        </Svg>
      )}
      <View style={[styles.logo, { width: logo, height: logo, backgroundColor: colors.paper, borderRadius: radii.md }]}>
        <Octopus size={logo * 0.74} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radii.lg,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
});
