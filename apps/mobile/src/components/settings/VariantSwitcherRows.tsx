import { Fragment } from 'react';

import { spacing } from '@/theme';
import { useBrand } from '@/lib/brand-context';
import { VARIANTS, type VariantId } from '@/lib/variants';
import { useTheme } from '@/lib/use-theme';
import { Divider } from '@/components/ui/Divider';
import { Icon } from '@/components/ui/Icon';
import { Row } from '@/components/ui/Row';

const ROWS: { id: VariantId; detail: string }[] = [
  { id: 'octochat', detail: 'channels · DMs · threads · automations' },
  { id: 'octodesk', detail: 'tickets · automations · threads' },
  { id: 'octopulse', detail: 'all features' },
];

const ICONS: Record<VariantId, 'chat' | 'work' | 'layers'> = {
  octochat: 'chat',
  octodesk: 'work',
  octopulse: 'layers',
};

/** Three-row variant picker. Renders inline inside a Card — no outer wrapper. */
export function VariantSwitcherRows() {
  const { colors } = useTheme();
  const { variant, setVariant } = useBrand();

  return (
    <>
      {ROWS.map(({ id, detail }, i) => {
        const active = variant.id === id;
        return (
          <Fragment key={id}>
            {i > 0 ? <Divider style={{ marginVertical: spacing.xs }} /> : null}
            <Row
              iconName={ICONS[id]}
              accent={active}
              title={VARIANTS[id].appName}
              detail={detail}
              right={active ? <Icon name="check" size={16} color={colors.accent} /> : undefined}
              onPress={active ? undefined : () => void setVariant(id)}
            />
          </Fragment>
        );
      })}
    </>
  );
}
