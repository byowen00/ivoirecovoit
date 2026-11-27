import type { Metadata } from 'next';
import { SupportChat } from './SupportChat';

export const metadata: Metadata = { title: 'Assistance' };

export default async function SupportChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupportChat id={id} />;
}
