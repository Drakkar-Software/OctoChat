import { useFonts } from 'expo-font';
import {
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from '@expo-google-fonts/hanken-grotesk';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';

import { iconSubsetFonts } from './icon-fonts';

/**
 * Loads every font family referenced by `fonts` in `src/theme.ts`, plus the
 * two subset icon families (`octochat-mci-subset`, `octochat-ion-subset`) that
 * back the 6 MaterialCommunityIcons / Ionicons glyphs in `Icon.tsx`.
 * Keys here MUST stay in sync with `src/theme.ts`. Returns `[loaded, error]`.
 */
export function useAppFonts(): [boolean, Error | null] {
  return useFonts({
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
    // Subset icon families — tiny (~1.4 KB + ~1.6 KB) replacements for the full
    // MCI (1.31 MB) and Ionicons (390 KB) TTFs. createIconSet self-loads these on
    // first render too, but preloading here avoids a tofu flash on first paint.
    ...iconSubsetFonts,
  });
}
