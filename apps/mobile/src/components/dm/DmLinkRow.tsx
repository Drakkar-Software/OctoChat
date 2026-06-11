import { useState } from 'react';

import { Row } from '@/components/ui/Row';

import { DmLinkSheet } from './DmLinkSheet';

/**
 * Settings row (the profile's About card) that opens the {@link DmLinkSheet}.
 * The QR isn't inlined here — the row just offers to show the dedicated share
 * screen, the same screen the DMs header opens via {@link ShareDmButton}.
 */
export function DmLinkRow() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Row iconName="qr" title="DM me link" detail="Show your QR code & share" onPress={() => setOpen(true)} />
      <DmLinkSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
