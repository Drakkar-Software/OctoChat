import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { StackScreen } from '@/components/ui/StackScreen';

export default function SearchScreen() {
  return (
    <StackScreen inTabs header={<AppBar title="Search" />}>
      <EmptyState
        iconName="search"
        title="Search everything"
        subtitle="Find messages, files and people across your encrypted spaces — decryption happens on-device."
      />
    </StackScreen>
  );
}
