import { type BookingStatus, statusLabel, statusTone } from '@/lib/bookings';

const TONE = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-ink',
  danger: 'bg-danger-soft text-danger',
  muted: 'bg-surface-muted text-ink-muted',
} as const;

export function BookingStatusBadge({ status, role = 'PASSENGER' }: { status: BookingStatus; role?: 'PASSENGER' | 'DRIVER' }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[statusTone(status)]}`}>{statusLabel(status, role)}</span>;
}
