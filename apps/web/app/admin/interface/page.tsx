import type { Metadata } from 'next';
import { InterfaceView } from './InterfaceView';

export const metadata: Metadata = { title: 'Interface et design' };

export default function InterfacePage() {
  return <InterfaceView />;
}
