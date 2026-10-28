import type { Metadata } from 'next';
import { UserList } from './UserList';

export const metadata: Metadata = { title: 'Utilisateurs' };

export default function UsersPage() {
  return <UserList />;
}
