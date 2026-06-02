import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentType } from 'react';

import { useTheme } from '@/lib/use-theme';

// Each vendor set types `name` as its own literal union; we map to a generic
// component and pass the resolved glyph name through.
type IconLib = ComponentType<any>;
type IconDef = { lib: IconLib; n: string };

/**
 * Curated, semantic icon set for OctoChat. Names mirror the wireframe's icon
 * vocabulary; each maps to a production glyph from @expo/vector-icons so the
 * line-art stays consistent across web and native.
 */
const ICONS = {
  hash: { lib: Feather, n: 'hash' },
  stream: { lib: Feather, n: 'activity' },
  lock: { lib: Feather, n: 'lock' },
  unlock: { lib: Feather, n: 'unlock' },
  plus: { lib: Feather, n: 'plus' },
  'plus-circle': { lib: Feather, n: 'plus-circle' },
  search: { lib: Feather, n: 'search' },
  send: { lib: Feather, n: 'send' },
  paperclip: { lib: Feather, n: 'paperclip' },
  smile: { lib: Feather, n: 'smile' },
  reply: { lib: Feather, n: 'corner-up-left' },
  thread: { lib: Feather, n: 'git-pull-request' },
  dm: { lib: Feather, n: 'message-square' },
  pin: { lib: MaterialCommunityIcons, n: 'pin' },
  mic: { lib: Feather, n: 'mic' },
  image: { lib: Feather, n: 'image' },
  video: { lib: Feather, n: 'video' },
  file: { lib: Feather, n: 'file' },
  link: { lib: Feather, n: 'link-2' },
  qr: { lib: MaterialCommunityIcons, n: 'qrcode' },
  'qr-scan': { lib: MaterialCommunityIcons, n: 'qrcode-scan' },
  check: { lib: Feather, n: 'check' },
  'check-circle': { lib: Feather, n: 'check-circle' },
  chev: { lib: Feather, n: 'chevron-right' },
  'chevron-down': { lib: Feather, n: 'chevron-down' },
  'chevron-up': { lib: Feather, n: 'chevron-up' },
  gear: { lib: Feather, n: 'settings' },
  bell: { lib: Feather, n: 'bell' },
  volume: { lib: Feather, n: 'volume-2' },
  'volume-off': { lib: Feather, n: 'volume-x' },
  menu: { lib: Feather, n: 'menu' },
  x: { lib: Feather, n: 'x' },
  'arrow-l': { lib: Feather, n: 'arrow-left' },
  'arrow-r': { lib: Feather, n: 'arrow-right' },
  shield: { lib: Feather, n: 'shield' },
  people: { lib: Feather, n: 'users' },
  user: { lib: Feather, n: 'user' },
  dots: { lib: Feather, n: 'more-horizontal' },
  'dots-v': { lib: Feather, n: 'more-vertical' },
  camera: { lib: Feather, n: 'camera' },
  key: { lib: Feather, n: 'key' },
  devices: { lib: MaterialCommunityIcons, n: 'devices' },
  copy: { lib: Feather, n: 'copy' },
  eye: { lib: Feather, n: 'eye' },
  'eye-off': { lib: Feather, n: 'eye-off' },
  alert: { lib: Feather, n: 'alert-triangle' },
  info: { lib: Feather, n: 'info' },
  edit: { lib: Feather, n: 'edit-2' },
  trash: { lib: Feather, n: 'trash-2' },
  logout: { lib: Feather, n: 'log-out' },
  at: { lib: Feather, n: 'at-sign' },
  clock: { lib: Feather, n: 'clock' },
  refresh: { lib: Feather, n: 'refresh-cw' },
  zap: { lib: Feather, n: 'zap' },
  globe: { lib: Ionicons, n: 'globe-outline' },
  folder: { lib: Feather, n: 'folder' },
  share: { lib: Feather, n: 'share' },
  // Workspace mode switcher (Chat / Agents / Work) + Work-mode group glyphs.
  chat: { lib: Feather, n: 'message-circle' },
  agents: { lib: Ionicons, n: 'sparkles-outline' },
  work: { lib: Feather, n: 'briefcase' },
  book: { lib: Feather, n: 'book-open' },
  target: { lib: Feather, n: 'target' },
  layers: { lib: Feather, n: 'layers' },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  size?: number;
  /** Defaults to the soft ink color. */
  color?: string;
}

export function Icon({ name, size = 16, color }: IconProps) {
  const { colors } = useTheme();
  const def = ICONS[name];
  const Glyph = def.lib as IconLib;
  return <Glyph name={def.n} size={size} color={color ?? colors.inkSoft} />;
}
