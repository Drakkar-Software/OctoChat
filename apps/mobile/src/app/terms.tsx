import { terms } from '@/lib/legal';
import { LegalPage } from '@/components/LegalPage';

export default function TermsScreen() {
  return <LegalPage doc={terms} />;
}
