// Public surface of @octochat/ui. Consumers import from `@octochat/ui`
// (which re-exports this barrel + the theme). Never add per-file subpaths to the
// package `exports` map — route everything through this barrel.

export { Switch } from '../primitives/switch';
export type { OctoSwitchProps } from '../primitives/switch';

export { SegmentedControl } from '../primitives/segmented-control';
export type { OctoSegmentedControlProps } from '../primitives/segmented-control';

export { Menu } from '../primitives/menu';
export type { OctoMenuAction, OctoMenuProps } from '../primitives/menu';

export { DateTimePicker } from '../primitives/datetime-picker';
export type { OctoDateTimePickerProps } from '../primitives/datetime-picker';

export { ForgeHost, useHostWrap, hostSeed } from '../primitives/_host/host';
export type { ForgeHostProps } from '../primitives/_host/host';
