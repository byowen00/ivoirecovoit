import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../bookings/widgets.dart';
import 'models.dart';

/// Écran 14 (Historique des paiements) : paiements et remboursements du passager, gains du conducteur.
class PaymentHistoryScreen extends StatelessWidget {
  const PaymentHistoryScreen({super.key, this.earningsFirst = false});
  final bool earningsFirst;

  @override
  Widget build(BuildContext context) => DefaultTabController(
    length: 2,
    initialIndex: earningsFirst ? 1 : 0,
    child: Scaffold(
      appBar: AppBar(
        title: const Text('Historique des paiements'),
        bottom: const TabBar(
          tabs: [
            Tab(text: 'Paiements'),
            Tab(text: 'Mes gains'),
          ],
        ),
      ),
      body: const TabBarView(children: [_TransactionsTab(), _EarningsTab()]),
    ),
  );
}

class _TransactionsTab extends ConsumerStatefulWidget {
  const _TransactionsTab();

  @override
  ConsumerState<_TransactionsTab> createState() => _TransactionsTabState();
}

class _TransactionsTabState extends ConsumerState<_TransactionsTab> {
  List<Transaction>? _items;
  String? _next;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool more = false}) async {
    try {
      final r = await ref.read(paymentsRepositoryProvider).transactions(cursor: more ? _next : null);
      if (mounted) {
        setState(() {
          _items = more ? [...?_items, ...r.items] : r.items;
          _next = r.next;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    if (items == null) {
      return Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!));
    }
    if (items.isEmpty) {
      return const Padding(padding: EdgeInsets.all(24), child: Text('Aucun paiement pour le moment.'));
    }
    final muted = Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          for (final t in items)
            Card(
              child: ListTile(
                onTap: () => context.push('/reservations/${t.bookingId}'),
                title: Row(
                  children: [
                    Expanded(child: Text(t.isRefund ? 'Remboursement' : 'Paiement')),
                    Text(
                      '${t.isRefund ? '+ ' : ''}${formatXof(t.amountXof)}',
                      style: TextStyle(fontWeight: FontWeight.bold, color: t.isRefund ? AppColors.success : null),
                    ),
                  ],
                ),
                subtitle: Text(
                  '${t.route}\n${formatDay(t.createdAt)} ${formatTime(t.createdAt)} · ${t.statusText}'
                  '${t.method != null ? ' · ${methodLabel[t.method] ?? t.method}' : ''}'
                  '${t.reason != null ? ' · ${refundReasonLabel[t.reason] ?? t.reason}' : ''} · Réf. ${t.bookingReference}',
                  style: muted,
                ),
              ),
            ),
          if (_next != null) OutlinedButton(onPressed: () => _load(more: true), child: const Text('Voir plus')),
        ],
      ),
    );
  }
}

class _EarningsTab extends ConsumerStatefulWidget {
  const _EarningsTab();

  @override
  ConsumerState<_EarningsTab> createState() => _EarningsTabState();
}

class _EarningsTabState extends ConsumerState<_EarningsTab> {
  Earnings? _e;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final e = await ref.read(paymentsRepositoryProvider).earnings();
      if (mounted) setState(() => _e = e);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final e = _e;
    if (e == null) return Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!));
    if (e.trips.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(24),
        child: Text(
          'Aucun gain pour le moment. Les gains apparaissent ici quand un passager a payé sa place sur l’un de vos trajets.',
        ),
      );
    }
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: AppColors.textMuted);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AmountRow('Payé par les passagers (part trajet)', e.grossXof),
                  AmountRow('Commission IvoireCovoit', e.commissionXof),
                  AmountRow('En attente', e.pendingXof),
                  AmountRow('Disponible', e.payableXof, strong: true),
                  AmountRow('Déjà versé', e.paidXof),
                  if (!e.payoutsAvailable) ...[
                    const SizedBox(height: 8),
                    Text(
                      'Les gains deviennent disponibles 48 h après la fin du trajet, sans réclamation en cours. '
                      'Le versement sur votre compte Mobile Money n’est pas encore ouvert : il sera mis en place avec le prestataire de paiement.',
                      style: muted,
                    ),
                  ],
                ],
              ),
            ),
          ),
          for (final t in e.trips)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AmountRow('${t.origin} → ${t.destination}', t.dueXof, strong: true),
                    Text('${formatDay(t.departureAt)} ${formatTime(t.departureAt)} · ${t.publicRef}', style: muted),
                    const Divider(),
                    for (final l in t.bookings)
                      AmountRow(
                        'Réf. ${l.reference} · ${l.seats} place${l.seats > 1 ? 's' : ''} · ${earningStatusLabel[l.status] ?? l.status}',
                        l.dueXof,
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
