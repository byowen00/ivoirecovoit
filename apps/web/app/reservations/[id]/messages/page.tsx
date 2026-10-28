import type { Metadata } from 'next';
import { ChatView } from './ChatView';

export const metadata: Metadata = { title: 'Messages' };

export default async function MessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatView bookingId={id} />;
}
