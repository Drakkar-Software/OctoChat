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

export { Sheet } from '../primitives/bottom-sheet';
export type { OctoSheetProps } from '../primitives/bottom-sheet';

export { Picker } from '../primitives/picker';
export type { OctoPickerProps, OctoPickerOption } from '../primitives/picker';

export { ForgeHost, useHostWrap, hostSeed } from '../primitives/_host/host';
export type { ForgeHostProps } from '../primitives/_host/host';
