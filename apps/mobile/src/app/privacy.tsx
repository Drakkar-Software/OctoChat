import { privacy } from '@/lib/legal';
import { LegalPage } from '@/components/LegalPage';

export default function PrivacyScreen() {
  return <LegalPage doc={privacy} />;
}
