import { useEffect, useState } from 'react';

import { getFcmTopicCount, subscribeFcmTopicCount } from './fcm';

/** Live count of FCM space-topic subscriptions. Stays at 0 on web. */
export function useFcmTopicCount(): number {
  const [count, setCount] = useState<number>(getFcmTopicCount());
  useEffect(() => subscribeFcmTopicCount(setCount), []);
  return count;
}
