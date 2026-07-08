import React, { useMemo } from 'react';
import MenuView, { type MenuAction } from '@expo/ui/community/menu';
import type { SFSymbol } from 'sf-symbols-typescript';

export interface OctoMenuAction {
  /** Label shown in the menu. */
  label: string;
  /** SF Symbol name for the leading icon (iOS). */
  sfSymbol?: SFSymbol;
  /** Renders the item with the system destructive (red) style. */
  destructive?: boolean;
  disabled?: boolean;
  /** Checkmark state — `'on'` shows a checkmark. */
  checked?: boolean;
  /** Invoked when this item is selected. */
  onPress?: () => void;
  /** Nested items — a submenu, or an inline section when `displayInline`. */
  subactions?: OctoMenuAction[];
  displayInline?: boolean;
}

export interface OctoMenuProps {
  /** The menu items. */
  actions: OctoMenuAction[];
  /** Trigger element. Tapping (or long-pressing, per `longPress`) opens the menu. */
  children: React.ReactNode;
  /** Open on long-press instead of tap. */
  longPress?: boolean;
  /** Menu title (iOS). */
  title?: string;
}

/** Flatten actions to `MenuView` shape while collecting an id → onPress lookup. */
function build(
  actions: OctoMenuAction[],
  prefix: string,
  handlers: Map<string, () => void>,
): MenuAction[] {
  return actions.map((a, i) => {
    const id = prefix ? `${prefix}.${i}` : `${i}`;
    if (a.onPress) handlers.set(id, a.onPress);
    const menuAction: MenuAction = {
      id,
      title: a.label,
      image: a.sfSymbol,
      state: a.checked ? 'on' : undefined,
      attributes: { destructive: a.destructive, disabled: a.disabled },
    };
    if (a.subactions?.length) {
      menuAction.subactions = build(a.subactions, id, handlers);
      menuAction.displayInline = a.displayInline;
    }
    return menuAction;
  });
}

/**
 * Native context / dropdown menu — SwiftUI `Menu`/`ContextMenu` on iOS, Compose
 * `DropdownMenu` on Android, via the `@expo/ui` community drop-in. Wraps a trigger
 * (`children`); the menu is anchored to it by the system.
 */
export function Menu({ actions, children, longPress = false, title }: OctoMenuProps) {
  const { menuActions, handlers } = useMemo(() => {
    const map = new Map<string, () => void>();
    return { menuActions: build(actions, '', map), handlers: map };
  }, [actions]);

  return (
    <MenuView
      title={title}
      actions={menuActions}
      shouldOpenOnLongPress={longPress}
      onPressAction={(e) => handlers.get(e.nativeEvent.event)?.()}
    >
      {children}
    </MenuView>
  );
}

Menu.displayName = 'OctoMenu';
