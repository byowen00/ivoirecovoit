import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../trips/trips_repository.dart';
import 'models.dart';
import 'widgets.dart';

const _byLabel = {'PASSENGER': 'passager', 'DRIVER': 'conducteur', 'SYSTEM': 'automatique', 'STAFF': 'IvoireCovoit'};

/// Écran 12 (détail) : statut, délai, montants, annulation ; acceptation ou refus pour le conducteur.
class BookingDetailScreen extends ConsumerStatefulWidget {
  const BookingDetailScreen({super.key, required this.bookingId});
  final String bookingId;

  @override
  ConsumerState<BookingDetailScreen> createState() => _BookingDetailScreenState();
}

class _BookingDetailScreenState extends ConsumerState<BookingDetailScreen> {
  Booking? _b;
  String? _error;
  bool _busy = false;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _load();
    // Compte à rebours du blocage des places, rafraîchi toutes les 30 s.
    _tick = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final b = await ref.read(bookingsRepositoryProvider).get(widget.bookingId);
      if (mounted) setState(() => _b = b);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.status == 404 ? 'Réservation introuvable.' : e.message);
    }
  }

  Future<void> _act(Future<Booking> Function() fn, String done) async {
    setState(() => _busy = true);
    try {
      final b = await fn();
      if (!mounted) return;
      setState(() => _b = b);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      await _load();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel() async {
    final b = _b!;
    final repo = ref.read(bookingsRepositoryProvider);
    CancelPreview preview;
    try {
      preview = await repo.cancelPreview(b.id);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      return;
    }
    if (!mounted) return;
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => _CancelDialog(preview: preview, driver: b.isDriver),
    );
    if (reason != null) {
      final key = newIdempotencyKey();
      await _act(() => repo.cancel(b.id, reason, key), 'Réservation annulée.');
    }
  }

  String? _statusText(Booking b, DateTime now) {
    final hold = b.holdExpiresAt;
    final left = hold?.difference(now);
    String until(DateTime d) =>
        '${formatTime(d)}${left != null && left.inMinutes < 60 ? ' (${left.inMinutes + 1} min)' : ''}';
    switch (b.status) {
      case 'PENDING_ACCEPTANCE':
        return b.isDriver
            ? 'Ce passager attend votre réponse${hold != null ? ' jusqu’au ${formatDay(hold)} à ${until(hold)}' : ''}. Sans réponse, la demande expire.'
            : 'Le conducteur doit accepter votre demande${hold != null ? ' avant le ${formatDay(hold)} à ${until(hold)}' : ''}. Vos places sont bloquées en attendant.';
      case 'PENDING_PAYMENT':
        return '${hold != null ? 'Places bloquées jusqu’à ${until(hold)}. ' : ''}'
            'Le paiement mobile (Wave, Orange Money, MTN MoMo, Moov Money) n’est pas encore disponible dans cette version : '
            'sans paiement, la réservation expirera et les places seront libérées.';
      case 'CONFIRMED':
        return b.paymentMethod == 'CASH'
            ? 'Réservation confirmée. Paiement en espèces de ${formatXof(b.subtotalXof)} au conducteur le jour du trajet.'
            : 'Réservation confirmée.';
      default:
        if (b.cancellationReason != null) return 'Motif : ${b.cancellationReason}';
        if ((b.refundDueXof ?? 0) > 0) return 'Remboursement prévu : ${formatXof(b.refundDueXof!)}.';
        return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = _b;
    if (b == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: _error == null
              ? const CircularProgressIndicator()
              : Padding(padding: const EdgeInsets.all(24), child: Text(_error!)),
        ),
      );
    }
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: AppColors.textMuted);
    final status = _statusText(b, DateTime.now());
    return Scaffold(
      appBar: AppBar(title: Text('${b.pickup.label} → ${b.dropoff.label}', overflow: TextOverflow.ellipsis)),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Wrap(
              spacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                BookingStatusChip(status: b.status, driver: b.isDriver),
                Text('Réf. ${b.reference}${b.isDemo ? '  [DEMO]' : ''}', style: muted),
              ],
            ),
            if (status != null) ...[const SizedBox(height: 8), NoticeBox(status, color: AppColors.surfaceMuted)],
            if (b.freeCancellation && b.can('canCancel') && !b.isDriver) ...[
              const SizedBox(height: 8),
              const NoticeBox('Le trajet a été modifié : vous pouvez annuler sans frais jusqu’au départ.'),
            ],
            if (b.can('canAccept') || b.can('canReject')) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  if (b.can('canAccept'))
                    FilledButton(
                      onPressed: _busy
                          ? null
                          : () => _act(
                              () => ref.read(bookingsRepositoryProvider).accept(b.id),
                              'Demande acceptée : le passager a été prévenu.',
                            ),
                      child: const Text('Accepter'),
                    ),
                  const SizedBox(width: 8),
                  if (b.can('canReject'))
                    OutlinedButton(
                      onPressed: _busy
                          ? null
                          : () => _act(
                              () => ref.read(bookingsRepositoryProvider).reject(b.id),
                              'Demande refusée : les places sont libérées.',
                            ),
                      child: const Text('Refuser'),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(formatDay(b.pickup.plannedAt), style: muted),
                    const SizedBox(height: 4),
                    Text('${formatTime(b.pickup.plannedAt)}  ${b.pickup.label}', style: theme.textTheme.titleMedium),
                    if (b.pickup.meetingPoint != null) Text(b.pickup.meetingPoint!, style: muted),
                    Text('${formatTime(b.dropoff.plannedAt)}  ${b.dropoff.label}', style: theme.textTheme.titleMedium),
                    if (b.dropoff.meetingPoint != null) Text(b.dropoff.meetingPoint!, style: muted),
                    Text('Heures de passage estimées.', style: muted),
                    const SizedBox(height: 8),
                    Text(
                      b.isDriver
                          ? 'Passager : ${b.passengerName ?? 'Passager'} · ${b.seats} place${b.seats > 1 ? 's' : ''}'
                          : 'Conducteur : ${b.driverName ?? '—'} · ${b.vehicle}${b.plateNumber != null ? ' · ${b.plateNumber}' : ''}',
                    ),
                    if (!b.isDriver && b.plateNumber == null)
                      Text('L’immatriculation s’affiche une fois la réservation confirmée.', style: muted),
                    TextButton(
                      style: TextButton.styleFrom(padding: EdgeInsets.zero),
                      onPressed: () =>
                          context.push(b.isDriver ? '/conducteur/trajets/${b.tripId}' : '/trajets/${b.tripId}'),
                      child: const Text('Voir le trajet'),
                    ),
                  ],
                ),
              ),
            ),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AmountRow(
                      '${formatXof(b.unitPriceXof)} × ${b.seats} place${b.seats > 1 ? 's' : ''}',
                      b.subtotalXof,
                    ),
                    AmountRow('Frais de service', b.serviceFeeXof),
                    if (b.discountXof > 0) AmountRow('Réduction', -b.discountXof),
                    const Divider(),
                    AmountRow('Total passager', b.totalXof, strong: true),
                    if (b.isDriver && b.driverNetXof != null) ...[
                      const SizedBox(height: 8),
                      AmountRow('Commission IvoireCovoit', -(b.commissionXof ?? 0)),
                      AmountRow('Vous recevrez', b.driverNetXof!, strong: true),
                    ],
                    const SizedBox(height: 8),
                    Text('Annulation (${b.policy.label}) : ${b.policy.summary}', style: muted),
                  ],
                ),
              ),
            ),
            if (b.can('canCancel'))
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
                  onPressed: _busy ? null : _cancel,
                  child: Text(b.isDriver ? 'Annuler cette réservation' : 'Annuler ma réservation'),
                ),
              ),
            const SizedBox(height: 12),
            Text('Historique', style: theme.textTheme.titleSmall),
            for (final h in b.history)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  '${formatDay(h.at)} ${formatTime(h.at)} · ${bookingStatusText(h.to, driver: b.isDriver)} (${_byLabel[h.by] ?? h.by})'
                  '${h.reason != null ? ' : ${h.reason}' : ''}',
                  style: muted,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _CancelDialog extends StatefulWidget {
  const _CancelDialog({required this.preview, required this.driver});
  final CancelPreview preview;
  final bool driver;

  @override
  State<_CancelDialog> createState() => _CancelDialogState();
}

class _CancelDialogState extends State<_CancelDialog> {
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Annuler la réservation ?'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(refundText(widget.preview)),
          if (!widget.driver && widget.preview.driverCompensationXof > 0)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'La part non remboursée revient au conducteur, qui vous avait réservé ces places.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          TextField(
            controller: _reason,
            maxLength: 300,
            maxLines: 2,
            decoration: InputDecoration(labelText: widget.driver ? 'Motif (visible du passager)' : 'Motif'),
            onChanged: (_) => setState(() {}),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context), child: const Text('Garder la réservation')),
      FilledButton(
        style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
        onPressed: _reason.text.trim().length >= 3 ? () => Navigator.pop(context, _reason.text.trim()) : null,
        child: const Text('Confirmer l’annulation'),
      ),
    ],
  );
}
