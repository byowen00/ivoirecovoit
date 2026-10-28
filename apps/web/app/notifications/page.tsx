import type { Metadata } from 'next';
import { NotificationList } from './NotificationList';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return <NotificationList />;
}
