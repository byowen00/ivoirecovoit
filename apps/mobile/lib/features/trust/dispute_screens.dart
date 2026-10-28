import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../trips/trips_repository.dart';
import 'models.dart';

/// Écran 16 : ouverture d'une réclamation sur une réservation.
class NewDisputeScreen extends ConsumerStatefulWidget {
  const NewDisputeScreen({super.key, required this.bookingId});
  final String bookingId;

  @override
  ConsumerState<NewDisputeScreen> createState() => _NewDisputeScreenState();
}

class _NewDisputeScreenState extends ConsumerState<NewDisputeScreen> {
  DisputeEligibility? _e;
  String? _reason;
  final _description = TextEditingController();
  String? _error;
  bool _busy = false;
  final _key = newIdempotencyKey();

  @override
  void initState() {
    super.initState();
    ref
        .read(trustRepositoryProvider)
        .disputeEligibility(widget.bookingId)
        .then(
          (e) {
            if (!mounted) return;
            if (e.openDisputeId != null) {
              context.replace('/aide/reclamations/${e.openDisputeId}');
            } else {
              setState(() => _e = e);
            }
          },
          onError: (Object e) {
            if (mounted) setState(() => _error = e is ApiException ? e.message : 'Chargement impossible.');
          },
        );
  }

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final d = await ref
          .read(trustRepositoryProvider)
          .openDispute(widget.bookingId, _reason!, _description.text.trim(), _key);
      if (mounted) context.replace('/aide/reclamations/${d.id}');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final e = _e;
    return Scaffold(
      appBar: AppBar(title: const Text('Nouvelle réclamation')),
      body: e == null
          ? Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!))
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (!e.allowed)
                  const Text(
                    'Une réclamation n’est pas possible pour cette réservation (délai dépassé ou trajet pas encore commencé).',
                  )
                else ...[
                  Text(
                    'L’autre personne pourra donner sa version, puis notre équipe décidera. '
                    'Vous serez prévenu à chaque étape.${e.deadline != null ? ' Possible jusqu’au ${formatDay(e.deadline!)}.' : ''}',
                  ),
                  const SizedBox(height: 12),
                  RadioGroup<String>(
                    groupValue: _reason,
                    onChanged: (v) => setState(() => _reason = v),
                    child: Column(
                      children: [for (final r in e.reasons) RadioListTile<String>(value: r.code, title: Text(r.label))],
                    ),
                  ),
                  TextField(
                    controller: _description,
                    minLines: 4,
                    maxLines: 8,
                    maxLength: 2000,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      labelText: 'Expliquez ce qui s’est passé (10 caractères minimum)',
                    ),
                  ),
                  if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.danger)),
                  FilledButton(
                    onPressed: _reason == null || _description.text.trim().length < 10 || _busy ? null : _submit,
                    child: const Text('Envoyer la réclamation'),
                  ),
                ],
              ],
            ),
    );
  }
}

const _from = {'ME': 'Vous', 'PASSENGER': 'Passager', 'DRIVER': 'Conducteur', 'SUPPORT': 'IvoireCovoit'};

/// Écran 16 : suivi d'une réclamation et échanges avec le support.
class DisputeScreen extends ConsumerStatefulWidget {
  const DisputeScreen({super.key, required this.disputeId});
  final String disputeId;

  @override
  ConsumerState<DisputeScreen> createState() => _DisputeScreenState();
}

class _DisputeScreenState extends ConsumerState<DisputeScreen> {
  Dispute? _d;
  String? _error;
  final _reply = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await ref.read(trustRepositoryProvider).dispute(widget.disputeId);
      if (mounted) setState(() => _d = d);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    try {
      final d = await ref.read(trustRepositoryProvider).replyDispute(widget.disputeId, _reply.text.trim());
      _reply.clear();
      if (mounted) setState(() => _d = d);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final muted = Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted);
    return Scaffold(
      appBar: AppBar(title: Text(d == null ? 'Réclamation' : 'Réclamation ${d.reference}')),
      body: d == null
          ? Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!))
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(disputeStatusLabel[d.status] ?? d.status, style: Theme.of(context).textTheme.titleMedium),
                        Text('${d.reasonLabel} · ${d.route} · réservation ${d.bookingReference}', style: muted),
                        if (d.responseDeadline != null && d.status == 'AWAITING_RESPONSE')
                          Text(
                            'Réponse attendue avant le ${formatDay(d.responseDeadline!)} à ${formatTime(d.responseDeadline!)}.',
                          ),
                        const SizedBox(height: 8),
                        Text(d.description),
                        if (d.decision != null || d.status == 'REJECTED') ...[
                          const Divider(),
                          Text(
                            'Décision : ${d.decision != null ? (disputeDecisionLabel[d.decision] ?? d.decision!) : 'réclamation rejetée'}'
                            '${d.decidedRefundXof != null ? ' (${formatXof(d.decidedRefundXof!)})' : ''}.',
                            style: const TextStyle(fontWeight: FontWeight.bold),
                          ),
                          if (d.decisionNote != null) Text(d.decisionNote!),
                        ],
                      ],
                    ),
                  ),
                ),
                for (final m in d.messages)
                  Card(
                    color: m.from == 'SUPPORT' ? AppColors.brandSoft : null,
                    child: ListTile(
                      title: Text(m.body),
                      subtitle: Text(
                        '${_from[m.from] ?? m.from} · ${formatDay(m.createdAt)} ${formatTime(m.createdAt)}',
                        style: muted,
                      ),
                    ),
                  ),
                if (d.canReply) ...[
                  TextField(
                    controller: _reply,
                    minLines: 2,
                    maxLines: 6,
                    maxLength: 2000,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(labelText: 'Ajouter un message'),
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton(
                      onPressed: _reply.text.trim().length < 2 || _busy ? null : _send,
                      child: const Text('Envoyer'),
                    ),
                  ),
                ],
                TextButton(
                  onPressed: () => context.push('/reservations/${d.bookingId}'),
                  child: const Text('Voir la réservation'),
                ),
              ],
            ),
    );
  }
}
