import { useState } from 'react';

import { IconButton } from '@/components/ui/IconButton';

import { DmLinkSheet } from './DmLinkSheet';

/**
 * Header action that opens the {@link DmLinkSheet} — share your own "DM me" QR /
 * link. Cross-platform (everyone can show their QR or copy the link); the camera
 * counterpart is {@link ScanDmButton}, which is native-only.
 */
export function ShareDmButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton name="share" accessibilityLabel="Share your DM link" onPress={() => setOpen(true)} />
      <DmLinkSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
