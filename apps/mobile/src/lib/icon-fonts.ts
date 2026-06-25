/**
 * Subset icon sets — tiny replacements for the full MaterialCommunityIcons (1.3 MB)
 * and Ionicons (390 KB) families. Only the 6 glyphs actually used by Icon.tsx are
 * included; the rest of the app's icons come from Feather (55 KB, unchanged).
 *
 * Regenerating the subset .ttf files after upgrading @expo/vector-icons
 * (requires `brew install fonttools`):
 *
 *   MCI_SRC=node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf
 *   ION_SRC=node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf
 *
 *   pyftsubset "$MCI_SRC" --unicodes=U+F0403,U+F0432,U+F0433,U+F0FB0 \
 *     --output-file=apps/mobile/assets/fonts/MaterialCommunityIcons.subset.ttf \
 *     --no-layout-closure
 *
 *   pyftsubset "$ION_SRC" --unicodes=U+F58C,U+F58D \
 *     --output-file=apps/mobile/assets/fonts/Ionicons.subset.ttf \
 *     --no-layout-closure
 *
 * Codepoints verified from
 *   node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/
 */
import createIconSet from '@expo/vector-icons/createIconSet';

/**
 * MaterialCommunityIcons glyphs used in Icon.tsx:
 *   pin (U+F0403), qrcode (U+F0432), qrcode-scan (U+F0433), devices (U+F0FB0).
 * Subset TTF: ~1.4 KB vs 1.31 MB for the full family.
 */
export const MciSubset = createIconSet(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  { pin: 0xf0403, qrcode: 0xf0432, 'qrcode-scan': 0xf0433, devices: 0xf0fb0 },
  'octochat-mci-subset',
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../assets/fonts/MaterialCommunityIcons.subset.ttf') as number,
);

/**
 * Ionicons glyphs used in Icon.tsx:
 *   sparkles (U+F58C), sparkles-outline (U+F58D).
 * Subset TTF: ~1.6 KB vs 390 KB for the full family.
 */
export const IoniconsSubset = createIconSet(
  { sparkles: 0xf58c, 'sparkles-outline': 0xf58d },
  'octochat-ion-subset',
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../assets/fonts/Ionicons.subset.ttf') as number,
);

/**
 * Spread into `useFonts({…})` in `use-app-fonts.ts` to preload both subset
 * families alongside the app's text fonts (avoids a first-render tofu flash for
 * the 6 icons; `createIconSet` self-loads on first render too, but explicit
 * preloading is faster on first paint).
 */
export const iconSubsetFonts = { ...MciSubset.font, ...IoniconsSubset.font };
