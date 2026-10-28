import type { Metadata } from 'next';
import { AccountSettings } from './AccountSettings';

export const metadata: Metadata = { title: 'Mon compte' };

export default function AccountPage() {
  return <AccountSettings />;
}
