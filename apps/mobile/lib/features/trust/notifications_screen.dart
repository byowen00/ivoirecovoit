import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import 'models.dart';

/// Ne garde que les liens internes de l'application (une notification ne fait jamais sortir de l'application).
String? internalLink(String? link) => link != null && link.startsWith('/') && !link.startsWith('//') ? link : null;

/// Écran 13 : notifications de l'application (le canal push n'est pas encore branché).
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  List<AppNotification>? _items;
  String? _next;
  int _unread = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({String? cursor}) async {
    try {
      final r = await ref.read(trustRepositoryProvider).notifications(cursor: cursor);
      if (!mounted) return;
      setState(() {
        _items = cursor == null ? r.items : [...?_items, ...r.items];
        _next = r.next;
        _unread = r.unread;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _open(AppNotification n) async {
    if (n.readAt == null) unawaited(ref.read(trustRepositoryProvider).markRead([n.id]).catchError((_) {}));
    final link = internalLink(n.link);
    if (link != null) {
      await context.push(link);
    }
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    final muted = Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (_unread > 0)
            TextButton(
              onPressed: () async {
                await ref.read(trustRepositoryProvider).markAllRead();
                await _load();
              },
              child: const Text('Tout marquer lu'),
            ),
        ],
      ),
      body: items == null
          ? Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (items.isEmpty)
                    const Padding(padding: EdgeInsets.all(24), child: Text('Aucune notification pour le moment.')),
                  for (final n in items)
                    Card(
                      child: ListTile(
                        leading: Icon(
                          n.readAt == null ? Icons.circle : Icons.circle_outlined,
                          size: 12,
                          color: n.readAt == null ? AppColors.brand : AppColors.textMuted,
                          semanticLabel: n.readAt == null ? 'Non lue' : 'Lue',
                        ),
                        title: Text(n.title, style: TextStyle(fontWeight: n.readAt == null ? FontWeight.bold : null)),
                        subtitle: Text('${n.body}\n${formatDay(n.createdAt)} ${formatTime(n.createdAt)}', style: muted),
                        isThreeLine: true,
                        onTap: () => _open(n),
                      ),
                    ),
                  if (_next != null)
                    TextButton(
                      onPressed: () => _load(cursor: _next),
                      child: const Text('Afficher plus'),
                    ),
                  const SizedBox(height: 8),
                  TextButton(onPressed: () => context.push('/compte'), child: const Text('Choisir mes notifications')),
                ],
              ),
            ),
    );
  }
}

/// Cloche avec le nombre de notifications non lues ; rafraîchie à chaque affichage de l'écran parent.
class NotificationBell extends ConsumerStatefulWidget {
  const NotificationBell({super.key});

  @override
  ConsumerState<NotificationBell> createState() => _NotificationBellState();
}

class _NotificationBellState extends ConsumerState<NotificationBell> {
  int _count = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _refresh();
    // Sans notification push, un rafraîchissement par minute tant que l'écran est ouvert.
    _timer = Timer.periodic(const Duration(seconds: 60), (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final c = await ref.read(trustRepositoryProvider).unreadCount();
      if (mounted) setState(() => _count = c);
    } on ApiException {
      // Hors connexion ou déconnecté : la cloche reste sans pastille.
    }
  }

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: _count > 0 ? 'Notifications ($_count non lues)' : 'Notifications',
      icon: Badge(
        isLabelVisible: _count > 0,
        label: Text(_count > 99 ? '99+' : '$_count'),
        child: const Icon(Icons.notifications_outlined),
      ),
      onPressed: () async {
        await context.push('/notifications');
        await _refresh();
      },
    );
  }
}

/// Préférences de notification (compte) ; les messages liés aux réservations et paiements restent obligatoires.
class NotificationPreferencesCard extends ConsumerStatefulWidget {
  const NotificationPreferencesCard({super.key});

  @override
  ConsumerState<NotificationPreferencesCard> createState() => _NotificationPreferencesCardState();
}

class _NotificationPreferencesCardState extends ConsumerState<NotificationPreferencesCard> {
  NotificationPreferences? _prefs;

  @override
  void initState() {
    super.initState();
    ref.read(trustRepositoryProvider).preferences().then((p) {
      if (mounted) setState(() => _prefs = p);
    }, onError: (_) {});
  }

  Future<void> _set(String code, bool v) async {
    try {
      final p = await ref.read(trustRepositoryProvider).setPreference(code, v);
      if (mounted) setState(() => _prefs = p);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _prefs;
    if (p == null) return const SizedBox.shrink();
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Text('Notifications', style: Theme.of(context).textTheme.titleMedium),
            ),
            for (final c in p.categories)
              SwitchListTile(
                value: c.enabled,
                title: Text(c.label),
                subtitle: c.mandatory ? const Text('Obligatoire : réservations, paiements et sécurité.') : null,
                onChanged: c.mandatory ? null : (v) => _set(c.code, v),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(
                p.pushAvailable ? 'Vous recevez aussi ces notifications sur votre téléphone.' : 'Les notifications s’affichent dans l’application ; l’envoi sur le téléphone (push) n’est pas encore activé.',
                style: const TextStyle(color: AppColors.textMuted),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
