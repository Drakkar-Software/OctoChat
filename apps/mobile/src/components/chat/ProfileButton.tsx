import { router } from 'expo-router';
import { Pressable } from 'react-native';
import Animated from 'react-native-reanimated';

import { useScalePress } from '@/lib/use-scale-press';
import { useSpaceHeader } from '@/lib/use-space-header';
import { Avatar } from '@/components/ui/Avatar';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The signed-in identity puck for the space header — a circular avatar that taps
 * through to the profile screen with a press-spring + haptic. Self-contained (it
 * reads the profile via {@link useSpaceHeader}), so both the web header and the
 * native nav-stack `headerRight` drop it in without wiring.
 */
export function ProfileButton({ ring = false }: { ring?: boolean }) {
  const { meLabel, avatar } = useSpaceHeader();
  const { animStyle, onPressIn, onPressOut } = useScalePress({ scaleTo: 0.9 });
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel="Your profile"
      hitSlop={8}
      onPress={() => router.push('/you')}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={animStyle}
    >
      <Avatar label={meLabel} image={avatar} size={30} ring={ring} />
    </AnimatedPressable>
  );
}
