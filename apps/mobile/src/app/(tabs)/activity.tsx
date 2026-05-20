import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { StackScreen } from '@/components/ui/StackScreen';

export default function ActivityScreen() {
  return (
    <StackScreen inTabs header={<AppBar title="Activity" />}>
      <EmptyState
        iconName="bell"
        title="You're all caught up"
        subtitle="Mentions, thread replies and reactions to your messages will surface here."
      />
    </StackScreen>
  );
}
