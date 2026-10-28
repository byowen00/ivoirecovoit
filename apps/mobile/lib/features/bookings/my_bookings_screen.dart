import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import 'models.dart';
import 'widgets.dart';

/// Écran 12 : mes réservations, à venir et passées.
class MyBookingsScreen extends StatelessWidget {
  const MyBookingsScreen({super.key});

  @override
  Widget build(BuildContext context) => DefaultTabController(
    length: 2,
    child: Scaffold(
      appBar: AppBar(
        title: const Text('Mes réservations'),
        bottom: const TabBar(
          tabs: [
            Tab(text: 'À venir'),
            Tab(text: 'Passées'),
          ],
        ),
      ),
      body: const TabBarView(
        children: [
          _BookingList(scope: 'upcoming'),
          _BookingList(scope: 'past'),
        ],
      ),
    ),
  );
}

class _BookingList extends ConsumerStatefulWidget {
  const _BookingList({required this.scope});
  final String scope;

  @override
  ConsumerState<_BookingList> createState() => _BookingListState();
}

class _BookingListState extends ConsumerState<_BookingList> {
  final List<BookingSummary> _items = [];
  String? _next;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  Future<void> _load({bool reset = false}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await ref.read(bookingsRepositoryProvider).mine(widget.scope, cursor: reset ? null : _next);
      if (!mounted) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll(page.bookings);
        _next = page.next;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted);
    if (_items.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: _loading
              ? const CircularProgressIndicator()
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _error ??
                          (widget.scope == 'upcoming' ? 'Aucune réservation à venir.' : 'Aucune réservation passée.'),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    if (_error != null)
                      OutlinedButton(onPressed: () => _load(reset: true), child: const Text('Réessayer'))
                    else if (widget.scope == 'upcoming')
                      FilledButton(onPressed: () => context.go('/'), child: const Text('Chercher un trajet')),
                  ],
                ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: () => _load(reset: true),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (final b in _items)
            Card(
              child: ListTile(
                onTap: () async {
                  await context.push('/reservations/${b.id}');
                  if (mounted) _load(reset: true);
                },
                title: Text('${b.pickupLabel} → ${b.dropoffLabel}${b.isDemo ? '  [DEMO]' : ''}'),
                subtitle: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 4),
                    BookingStatusChip(status: b.status),
                    const SizedBox(height: 4),
                    Text(
                      '${formatDay(b.pickupAt)} à ${formatTime(b.pickupAt)} · ${b.seats} place${b.seats > 1 ? 's' : ''} · ${formatXof(b.totalXof)}',
                    ),
                    Text('Réf. ${b.reference}${b.driverName != null ? ' · avec ${b.driverName}' : ''}', style: muted),
                  ],
                ),
                trailing: const Icon(Icons.chevron_right),
              ),
            ),
          if (_next != null) TextButton(onPressed: _loading ? null : () => _load(), child: const Text('Afficher plus')),
        ],
      ),
    );
  }
}
