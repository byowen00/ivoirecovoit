import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../bookings/models.dart';
import 'models.dart';
import 'report_sheet.dart';

/// Messagerie, partage du trajet, avis, réclamation et signalement depuis une réservation.
class BookingTrustSection extends ConsumerWidget {
  const BookingTrustSection({super.key, required this.booking, required this.onChanged});
  final Booking booking;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final b = booking;
    final other = b.isDriver ? 'le passager' : 'le conducteur';
    final otherId = b.isDriver ? b.passengerId : b.driverId;
    final ended = b.status == 'COMPLETED' || b.status.startsWith('CANCELLED') || b.status == 'NO_SHOW';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Échanger et voyager en sécurité', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (b.can('canMessage') || b.status == 'COMPLETED')
                      OutlinedButton.icon(
                        icon: const Icon(Icons.chat_bubble_outline),
                        label: Text(b.can('canMessage') ? 'Écrire à $other' : 'Revoir les messages'),
                        onPressed: () => context.push('/reservations/${b.id}/messages'),
                      ),
                    OutlinedButton.icon(
                      icon: const Icon(Icons.local_phone_outlined),
                      label: const Text('Numéros d’urgence'),
                      onPressed: () => context.push('/aide'),
                    ),
                    if (otherId != null)
                      OutlinedButton.icon(
                        icon: const Icon(Icons.flag_outlined),
                        label: Text('Signaler $other'),
                        onPressed: () => showReportSheet(
                          context,
                          targetType: 'USER',
                          targetId: otherId,
                          bookingId: b.id,
                          title: 'Signaler $other',
                        ),
                      ),
                  ],
                ),
                if (b.can('canShare')) _ShareBlock(booking: b),
              ],
            ),
          ),
        ),
        if (b.status == 'COMPLETED') _ReviewBlock(booking: b, onChanged: onChanged),
        if (b.openDispute != null)
          Card(
            child: ListTile(
              title: Text('Réclamation ${b.openDispute!.reference}'),
              subtitle: Text(disputeStatusLabel[b.openDispute!.status] ?? b.openDispute!.status),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/aide/reclamations/${b.openDispute!.id}'),
            ),
          )
        else if (ended || b.tripStatus == 'IN_PROGRESS' || b.tripStatus == 'COMPLETED')
          _DisputeBlock(booking: b),
      ],
    );
  }
}

class _ShareBlock extends ConsumerStatefulWidget {
  const _ShareBlock({required this.booking});
  final Booking booking;

  @override
  ConsumerState<_ShareBlock> createState() => _ShareBlockState();
}

class _ShareBlockState extends ConsumerState<_ShareBlock> {
  ShareLink? _link;
  ({bool active, DateTime? expiresAt})? _status;
  String? _error;

  @override
  void initState() {
    super.initState();
    ref.read(trustRepositoryProvider).shareStatus(widget.booking.id).then((s) {
      if (mounted) setState(() => _status = s);
    }, onError: (_) {});
  }

  Future<void> _create() async {
    try {
      final l = await ref.read(trustRepositoryProvider).createShare(widget.booking.id);
      if (mounted) {
        setState(() {
          _link = l;
          _status = (active: true, expiresAt: l.expiresAt);
          _error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _revoke() async {
    try {
      await ref.read(trustRepositoryProvider).revokeShare(widget.booking.id);
      if (mounted) {
        setState(() {
          _link = null;
          _status = (active: false, expiresAt: null);
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.booking;
    final link = _link;
    final text = link == null ? '' : shareMessage(link.url, '${b.pickup.label} → ${b.dropoff.label}');
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Divider(),
          Text('Partager mon trajet avec un proche', style: Theme.of(context).textTheme.titleSmall),
          const Text(
            'Le lien montre le trajet, les horaires estimés, le prénom du conducteur et le véhicule. '
            'Il ne donne aucune position GPS et expire après l’arrivée.',
            style: TextStyle(color: AppColors.textMuted),
          ),
          const SizedBox(height: 8),
          if (link != null)
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  icon: const Icon(Icons.sms_outlined),
                  label: const Text('Envoyer par SMS'),
                  onPressed: () => launchUrl(smsUri(text)),
                ),
                OutlinedButton.icon(
                  icon: const Icon(Icons.copy),
                  label: const Text('Copier le lien'),
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: link.url));
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Lien copié.')));
                    }
                  },
                ),
              ],
            )
          else
            OutlinedButton(
              onPressed: _create,
              child: Text(
                _status?.active == true
                    ? 'Créer un nouveau lien (l’ancien ne marchera plus)'
                    : 'Créer un lien de partage',
              ),
            ),
          if (_status?.active == true)
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Lien actif${_status!.expiresAt != null ? ' jusqu’au ${formatDay(_status!.expiresAt!)} à ${formatTime(_status!.expiresAt!)}' : ''}.',
                    style: const TextStyle(color: AppColors.textMuted),
                  ),
                ),
                TextButton(
                  style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                  onPressed: _revoke,
                  child: const Text('Désactiver'),
                ),
              ],
            ),
          if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.danger)),
        ],
      ),
    );
  }
}

class _ReviewBlock extends ConsumerStatefulWidget {
  const _ReviewBlock({required this.booking, required this.onChanged});
  final Booking booking;
  final VoidCallback onChanged;

  @override
  ConsumerState<_ReviewBlock> createState() => _ReviewBlockState();
}

class _ReviewBlockState extends ConsumerState<_ReviewBlock> {
  ReviewStatus? _s;
  int _rating = 0;
  final _comment = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    ref.read(trustRepositoryProvider).reviewStatus(widget.booking.id).then((s) {
      if (mounted) setState(() => _s = s);
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final c = _comment.text.trim();
      final s = await ref.read(trustRepositoryProvider).review(widget.booking.id, _rating, c.isEmpty ? null : c);
      if (mounted) setState(() => _s = s);
      widget.onChanged();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _s;
    if (s == null || (!s.canReview && s.mineRating == null)) return const SizedBox.shrink();
    final who = s.subjectRole == 'DRIVER' ? 'le conducteur' : 'le passager';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Votre avis sur $who', style: Theme.of(context).textTheme.titleMedium),
            if (s.mineRating != null)
              Text(
                'Vous avez donné ${s.mineRating}/5${s.mineComment != null ? ' : « ${s.mineComment} »' : ''}. '
                '${s.minePublished ? 'Avis publié.' : 'Il sera publié quand l’autre personne aura donné le sien, ou à la fin du délai.'}',
              )
            else ...[
              StarPicker(value: _rating, onChanged: (v) => setState(() => _rating = v)),
              TextField(
                controller: _comment,
                maxLength: 500,
                decoration: const InputDecoration(labelText: 'Commentaire (facultatif, public)'),
              ),
              if (s.deadline != null)
                Text(
                  'Possible jusqu’au ${formatDay(s.deadline!)}.',
                  style: const TextStyle(color: AppColors.textMuted),
                ),
              if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.danger)),
              const SizedBox(height: 8),
              FilledButton(onPressed: _rating == 0 || _busy ? null : _submit, child: const Text('Publier mon avis')),
            ],
          ],
        ),
      ),
    );
  }
}

const _ratingLabels = ['', 'Très mauvais', 'Mauvais', 'Correct', 'Bien', 'Excellent'];

/// Choix d'une note de 1 à 5.
class StarPicker extends StatelessWidget {
  const StarPicker({super.key, required this.value, required this.onChanged});
  final int value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (var n = 1; n <= 5; n++)
          IconButton(
            tooltip: '$n sur 5 : ${_ratingLabels[n]}',
            onPressed: () => onChanged(n),
            icon: Icon(
              n <= value ? Icons.star : Icons.star_border,
              color: n <= value ? AppColors.accent : AppColors.textMuted,
              size: 32,
            ),
          ),
        if (value > 0) Text(_ratingLabels[value]),
      ],
    );
  }
}

class _DisputeBlock extends ConsumerStatefulWidget {
  const _DisputeBlock({required this.booking});
  final Booking booking;

  @override
  ConsumerState<_DisputeBlock> createState() => _DisputeBlockState();
}

class _DisputeBlockState extends ConsumerState<_DisputeBlock> {
  DisputeEligibility? _e;

  @override
  void initState() {
    super.initState();
    ref.read(trustRepositoryProvider).disputeEligibility(widget.booking.id).then((e) {
      if (mounted) setState(() => _e = e);
    }, onError: (_) {});
  }

  @override
  Widget build(BuildContext context) {
    final e = _e;
    if (e == null || !e.allowed) return const SizedBox.shrink();
    return Card(
      child: ListTile(
        title: const Text('Un problème avec ce trajet ?'),
        subtitle: Text(
          'Absence, retard, montant : ouvrez une réclamation${e.deadline != null ? ' jusqu’au ${formatDay(e.deadline!)}' : ''}.',
        ),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => context.push('/aide/reclamations/nouvelle?reservation=${widget.booking.id}'),
      ),
    );
  }
}
