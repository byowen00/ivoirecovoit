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

/// Écran 8 : places, montée et descente, récapitulatif des montants, conditions d'annulation.
class BookingScreen extends ConsumerStatefulWidget {
  const BookingScreen({
    super.key,
    required this.tripId,
    required this.pickupStopId,
    required this.dropoffStopId,
    this.seats = 1,
  });
  final String tripId;
  final String pickupStopId;
  final String dropoffStopId;
  final int seats;

  @override
  ConsumerState<BookingScreen> createState() => _BookingScreenState();
}

class _BookingScreenState extends ConsumerState<BookingScreen> {
  late int _seats = widget.seats.clamp(1, 4);
  BookingQuote? _quote;
  String? _error;
  bool _accepted = false;
  bool _cash = false;
  bool _busy = false;
  int _request = 0;
  // Code promo vérifié par le devis, et saisie en cours.
  String? _promo;
  String? _promoError;
  final _promoInput = TextEditingController();
  // Une clé par écran : un double appui ou une reprise réseau ne crée pas deux réservations.
  final _key = newIdempotencyKey();

  String get _here =>
      '/trajets/${widget.tripId}/reserver?pickup=${widget.pickupStopId}&dropoff=${widget.dropoffStopId}&seats=$_seats';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _promoInput.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final id = ++_request;
    setState(() {
      _quote = null;
      _error = null;
    });
    try {
      final q = await ref
          .read(bookingsRepositoryProvider)
          .quote(widget.tripId, widget.pickupStopId, widget.dropoffStopId, _seats, promoCode: _promo);
      if (mounted && id == _request) setState(() => _quote = q);
    } on ApiException catch (e) {
      if (!mounted || id != _request) return;
      if (e.code == 'PROMO_INVALID') {
        // Le code n'est plus valable : on l'enlève et on recalcule sans lui.
        setState(() {
          _promo = null;
          _promoError = e.message;
        });
        _load();
      } else if (e.code == 'PROFILE_INCOMPLETE') {
        context.go('/inscription/profil?next=${Uri.encodeComponent(_here)}');
      } else {
        setState(() => _error = e.message);
      }
    }
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final b = await ref
          .read(bookingsRepositoryProvider)
          .create(
            widget.tripId,
            widget.pickupStopId,
            widget.dropoffStopId,
            _seats,
            idempotencyKey: _key,
            cash: _cash,
            promoCode: _quote?.promoCode,
          );
      if (mounted) context.go('/reservations/${b.id}');
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        if (e.code == 'PROMO_INVALID') _promo = null;
        _error = e.code == 'ALREADY_BOOKED'
            ? 'Vous avez déjà une réservation en cours sur ce trajet. Retrouvez-la dans « Mes réservations ».'
            : e.message;
      });
    }
  }

  void _applyPromo() {
    final code = _promoInput.text.trim().toUpperCase();
    if (code.isEmpty) return;
    setState(() {
      _promo = code;
      _promoError = null;
    });
    _load();
  }

  Widget _promoField(BookingQuote q) {
    if (q.promoCode != null) {
      return Row(
        children: [
          Expanded(
            child: Text('Code ${q.promoCode} appliqué.', style: const TextStyle(color: AppColors.success)),
          ),
          TextButton(
            onPressed: () {
              setState(() => _promo = null);
              _load();
            },
            child: const Text('Retirer'),
          ),
        ],
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: TextField(
            controller: _promoInput,
            textCapitalization: TextCapitalization.characters,
            decoration: InputDecoration(labelText: 'Code promo (facultatif)', errorText: _promoError),
            onSubmitted: (_) => _applyPromo(),
          ),
        ),
        const SizedBox(width: 8),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: OutlinedButton(onPressed: _applyPromo, child: const Text('Appliquer')),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final q = _quote;
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: AppColors.textMuted);
    return Scaffold(
      appBar: AppBar(title: const Text('Réserver')),
      bottomNavigationBar: q == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: FilledButton(
                  onPressed: !_accepted || _busy || q.seatsAvailable < q.seats ? null : _submit,
                  child: Text(_busy ? 'Réservation…' : (q.manual ? 'Envoyer la demande' : 'Réserver')),
                ),
              ),
            ),
      body: q == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_error!, style: const TextStyle(color: AppColors.danger)),
                          const SizedBox(height: 12),
                          OutlinedButton(onPressed: _load, child: const Text('Réessayer')),
                        ],
                      ),
                    ),
            )
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(formatDay(q.pickup.plannedAt), style: muted),
                        const SizedBox(height: 4),
                        Text(
                          '${formatTime(q.pickup.plannedAt)}  ${q.pickup.label}',
                          style: theme.textTheme.titleMedium,
                        ),
                        Text(
                          '${formatTime(q.dropoff.plannedAt)}  ${q.dropoff.label}',
                          style: theme.textTheme.titleMedium,
                        ),
                        Text('Heures de passage estimées.', style: muted),
                        const SizedBox(height: 12),
                        DropdownButtonFormField<int>(
                          initialValue: _seats,
                          decoration: const InputDecoration(labelText: 'Nombre de places'),
                          items: [
                            for (var n = 1; n <= 4; n++)
                              DropdownMenuItem(
                                value: n,
                                enabled: n <= q.seatsAvailable || n <= _seats,
                                child: Text('$n place${n > 1 ? 's' : ''}'),
                              ),
                          ],
                          onChanged: (v) {
                            if (v == null || v == _seats) return;
                            setState(() => _seats = v);
                            _load();
                          },
                        ),
                        if (q.seatsAvailable < q.seats)
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text(
                              'Plus que ${q.seatsAvailable} place(s) libre(s) sur ce segment.',
                              style: const TextStyle(color: AppColors.danger),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        AmountRow(
                          '${formatXof(q.unitPriceXof)} × ${q.seats} place${q.seats > 1 ? 's' : ''}',
                          q.subtotalXof,
                        ),
                        AmountRow('Frais de service', q.serviceFeeXof),
                        if (q.discountXof > 0)
                          AmountRow(q.promoCode == null ? 'Réduction' : 'Code promo ${q.promoCode}', -q.discountXof),
                        const Divider(),
                        AmountRow('Total', q.totalXof, strong: true),
                        const SizedBox(height: 8),
                        _promoField(q),
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
                        Text(
                          q.manual
                              ? 'Le conducteur accepte chaque demande'
                                    '${q.acceptanceDeadline != null ? ', au plus tard le ${formatDay(q.acceptanceDeadline!)} à ${formatTime(q.acceptanceDeadline!)}' : ''}. '
                                    'Vos places sont bloquées en attendant sa réponse.'
                              : 'Réservation instantanée : vos places sont bloquées ${q.holdMinutes} min, le temps de payer.',
                        ),
                        const SizedBox(height: 8),
                        if (!_cash)
                          Text(
                            '${q.manual ? 'Une fois la demande acceptée, vous payez' : 'Vous payez ensuite'} par Mobile Money '
                            '(Wave, Orange Money, MTN MoMo, Moov Money) ; sans paiement dans le délai, '
                            'la réservation expire et les places sont libérées.',
                          ),
                        if (q.cashAllowed)
                          CheckboxListTile(
                            contentPadding: EdgeInsets.zero,
                            controlAffinity: ListTileControlAffinity.leading,
                            value: _cash,
                            onChanged: (v) => setState(() => _cash = v ?? false),
                            title: Text(
                              'Payer en espèces au conducteur (${formatXof(q.subtotalXof)}, à régler le jour du trajet)',
                            ),
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
                        Text('Conditions d’annulation : ${q.policy.label}', style: theme.textTheme.titleSmall),
                        const SizedBox(height: 4),
                        Text(q.policy.summary),
                        CheckboxListTile(
                          contentPadding: EdgeInsets.zero,
                          controlAffinity: ListTileControlAffinity.leading,
                          value: _accepted,
                          onChanged: (v) => setState(() => _accepted = v ?? false),
                          title: const Text('J’accepte les conditions d’annulation'),
                        ),
                      ],
                    ),
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(_error!, style: const TextStyle(color: AppColors.danger)),
                  ),
              ],
            ),
    );
  }
}
