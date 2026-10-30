import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../bookings/models.dart';
import '../bookings/widgets.dart';
import '../trips/trips_repository.dart';
import 'models.dart';

/// Ouvre la page de l'opérateur (ou du bac à sable) dans le navigateur ; remplaçable dans les tests.
typedef UrlOpener = Future<bool> Function(Uri url);
Future<bool> _openExternal(Uri url) => launchUrl(url, mode: LaunchMode.externalApplication);

/// Écran 9 (Paiement) : moyen et numéro payeur, attente de la validation sur le téléphone, résultat.
/// Le résultat affiché vient toujours du serveur (GET /payments/:id), jamais du retour de la page de l'opérateur.
class PaymentScreen extends ConsumerStatefulWidget {
  const PaymentScreen({
    super.key,
    required this.bookingId,
    this.pollInterval = const Duration(seconds: 3),
    this.openUrl = _openExternal,
  });
  final String bookingId;
  final Duration pollInterval;
  final UrlOpener openUrl;

  @override
  ConsumerState<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<PaymentScreen> {
  Booking? _booking;
  PaymentMethods? _methods;
  Payment? _payment;
  NextAction? _action;
  String? _method;
  final _phone = TextEditingController();
  String _key = newIdempotencyKey();
  bool _busy = false;
  String? _error;
  Timer? _poll;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _load();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    _tick?.cancel();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final payments = ref.read(paymentsRepositoryProvider);
      final results = await Future.wait([
        ref.read(bookingsRepositoryProvider).get(widget.bookingId),
        payments.methods(),
      ]);
      final b = results[0] as Booking;
      if (!mounted) return;
      setState(() {
        _booking = b;
        _methods = results[1] as PaymentMethods;
      });
      // Paiement déjà en cours (application rouverte) : on reprend le suivi.
      if (_payment == null && b.pendingPaymentId != null) _follow(await payments.get(b.pendingPaymentId!));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.status == 404 ? 'Réservation introuvable.' : e.message);
    }
  }

  void _follow(Payment p) {
    if (!mounted) return;
    setState(() => _payment = p);
    _poll?.cancel();
    if (!p.waiting) return;
    _poll = Timer.periodic(widget.pollInterval, (_) async {
      try {
        final next = await ref.read(paymentsRepositoryProvider).get(p.id);
        if (!mounted) return;
        setState(() => _payment = next);
        if (!next.waiting) {
          _poll?.cancel();
          final b = await ref.read(bookingsRepositoryProvider).get(widget.bookingId);
          if (mounted) setState(() => _booking = b);
        }
      } on ApiException {
        // Réseau instable : on réessaiera au prochain passage.
      }
    });
  }

  Future<void> _submit() async {
    if (_method == null) return setState(() => _error = 'Choisissez un moyen de paiement.');
    if (!isCiMobile(_phone.text)) {
      return setState(() => _error = 'Numéro mobile ivoirien attendu (10 chiffres, par exemple 07 07 07 07 07).');
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final p = await ref.read(paymentsRepositoryProvider).initiate(widget.bookingId, _method!, _phone.text, _key);
      _action = p.nextAction;
      _follow(p);
      final url = p.nextAction?.url;
      if (p.nextAction?.type == 'REDIRECT' && url != null) await widget.openUrl(Uri.parse(url));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
      await _load();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _retry() {
    _poll?.cancel();
    setState(() {
      _payment = null;
      _action = null;
      _key = newIdempotencyKey();
    });
    _load();
  }

  String _countdown(Duration d) {
    if (d.isNegative) return 'délai dépassé';
    return '${d.inMinutes} min ${(d.inSeconds % 60).toString().padLeft(2, '0')} s';
  }

  @override
  Widget build(BuildContext context) {
    final b = _booking;
    final methods = _methods;
    if (b == null || methods == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Paiement')),
        body: Center(
          child: _error == null
              ? const CircularProgressIndicator()
              : Padding(padding: const EdgeInsets.all(24), child: Text(_error!)),
        ),
      );
    }
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: AppColors.textMuted);
    final now = DateTime.now();
    final holdLeft = b.holdExpiresAt?.difference(now) ?? Duration.zero;
    final holdOpen = !holdLeft.isNegative && holdLeft > Duration.zero;
    final p = _payment;
    final outcome = p == null ? null : paymentOutcome(p, holdOpen: holdOpen && b.status == 'PENDING_PAYMENT');

    return Scaffold(
      appBar: AppBar(title: const Text('Paiement')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('${b.pickup.label} → ${b.dropoff.label} · Réf. ${b.reference}', style: muted),
          const SizedBox(height: 8),
          if (methods.sandbox) ...[
            const NoticeBox(
              'Bac à sable : aucun argent réel n’est débité. La validation se fait sur une page de paiement simulée.',
            ),
            const SizedBox(height: 8),
          ],
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: AmountRow('Total à payer', b.totalXof, strong: true),
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(_error!, style: TextStyle(color: AppColors.danger)),
            ),
          if (p == null && b.can('canPay')) ...[
            Text('Places bloquées encore ${_countdown(holdLeft)}.'),
            const SizedBox(height: 12),
            Text('Payer avec', style: theme.textTheme.titleMedium),
            const SizedBox(height: 10),
            Semantics(
              label: 'Moyen de paiement',
              child: Column(
                children: [
                  for (final m in methods.methods)
                    _OperatorTile(method: m, selected: _method == m, onTap: () => setState(() => _method = m)),
                ],
              ),
            ),
            if (methods.methods.isEmpty)
              Text(
                'Aucun moyen de paiement n’est disponible pour le moment.',
                style: TextStyle(color: AppColors.danger),
              ),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'Numéro qui paie',
                hintText: '07 07 07 07 07',
                prefixText: '+225 ',
              ),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(color: AppColors.successSoft, borderRadius: BorderRadius.circular(14)),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.lock_outline, size: 20, color: Color(0xFF0B5A3A)),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Vous validerez le paiement sur ce téléphone, chez votre opérateur. '
                      'IvoireCovoit ne vous demandera jamais votre code secret Mobile Money.',
                      style: TextStyle(fontSize: 13, height: 1.45, color: Color(0xFF0B4A31)),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _busy || !holdOpen || methods.methods.isEmpty ? null : _submit,
              child: Text(_busy ? 'Envoi…' : 'Payer ${formatXof(b.totalXof)}'),
            ),
          ],
          if (p == null && !b.can('canPay'))
            Text(
              b.status == 'CONFIRMED'
                  ? 'Cette réservation est déjà confirmée.'
                  : 'Cette réservation n’attend pas de paiement.',
            ),
          if (p != null && outcome!.kind == OutcomeKind.waiting) ...[
            Text('En attente de validation', style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            Text('${methodLabel[p.method] ?? p.method} · ${p.payerPhoneMasked ?? ''} · ${formatXof(p.amountXof)}'),
            const SizedBox(height: 8),
            Text(
              _action?.instructions ?? 'Validez le paiement sur votre téléphone. Cet écran se met à jour tout seul.',
            ),
            if (_action?.url != null) ...[
              const SizedBox(height: 8),
              FilledButton(
                onPressed: () => widget.openUrl(Uri.parse(_action!.url!)),
                child: Text(p.sandbox ? 'Ouvrir la page de paiement simulée' : 'Continuer chez l’opérateur'),
              ),
            ],
            const SizedBox(height: 8),
            Text('Délai restant : ${_countdown(p.expiresAt.difference(now))}.', style: muted),
          ],
          if (p != null && outcome!.kind == OutcomeKind.confirmed) ...[
            Text('Paiement confirmé', style: theme.textTheme.titleMedium?.copyWith(color: AppColors.success)),
            const SizedBox(height: 4),
            Text(
              '${formatXof(p.amountXof)} payés avec ${methodLabel[p.method] ?? p.method}. Votre réservation est confirmée.',
            ),
            const SizedBox(height: 8),
            FilledButton(onPressed: () => context.pop(), child: const Text('Voir ma réservation')),
          ],
          if (p != null && outcome!.kind == OutcomeKind.late) ...[
            Text('Paiement reçu trop tard', style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(outcome.text),
            TextButton(onPressed: () => context.push('/paiements'), child: const Text('Suivre le remboursement')),
          ],
          if (p != null && outcome!.kind == OutcomeKind.failed) ...[
            Text('Paiement non abouti', style: theme.textTheme.titleMedium?.copyWith(color: AppColors.danger)),
            const SizedBox(height: 4),
            Text(outcome.text),
            const SizedBox(height: 8),
            if (outcome.canRetry) FilledButton(onPressed: _retry, child: const Text('Réessayer')),
          ],
        ],
      ),
    );
  }
}

/// Choix d'un opérateur : carte avec initiales, bordure orange quand il est choisi.
class _OperatorTile extends StatelessWidget {
  const _OperatorTile({required this.method, required this.selected, required this.onTap});
  final String method;
  final bool selected;
  final VoidCallback onTap;

  static const _initials = {'WAVE': 'W', 'ORANGE_MONEY': 'OM', 'MTN_MOMO': 'M', 'MOOV_MONEY': 'MV'};

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Semantics(
      inMutuallyExclusiveGroup: true,
      checked: selected,
      child: Material(
        color: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: selected ? AppColors.brand : AppColors.border, width: 2),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: AppColors.night, borderRadius: BorderRadius.circular(12)),
                  child: Text(
                    _initials[method] ?? method.substring(0, 1),
                    style: const TextStyle(
                      fontFamily: AppTheme.displayFont,
                      fontWeight: FontWeight.w800,
                      fontSize: 15,
                      color: Colors.white,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    methodLabel[method] ?? method,
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                ),
                Container(
                  width: 22,
                  height: 22,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: selected ? AppColors.brand : const Color(0xFFB8BEB8),
                      width: selected ? 7 : 2,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
