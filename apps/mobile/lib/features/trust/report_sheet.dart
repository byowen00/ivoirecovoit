import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../trips/trips_repository.dart';
import 'models.dart';

/// Ouvre le formulaire de signalement (personne, message, avis ou trajet).
Future<void> showReportSheet(
  BuildContext context, {
  required String targetType,
  required String targetId,
  String? bookingId,
  required String title,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  builder: (_) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
    child: ReportForm(targetType: targetType, targetId: targetId, bookingId: bookingId, title: title),
  ),
);

class ReportForm extends ConsumerStatefulWidget {
  const ReportForm({super.key, required this.targetType, required this.targetId, this.bookingId, required this.title});
  final String targetType;
  final String targetId;
  final String? bookingId;
  final String title;

  @override
  ConsumerState<ReportForm> createState() => _ReportFormState();
}

class _ReportFormState extends ConsumerState<ReportForm> {
  String? _category;
  final _description = TextEditingController();
  bool _busy = false;
  bool _sent = false;
  String? _error;
  final _key = newIdempotencyKey();

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
      await ref
          .read(trustRepositoryProvider)
          .report(
            targetType: widget.targetType,
            targetId: widget.targetId,
            bookingId: widget.bookingId,
            category: _category!,
            description: _description.text.trim(),
            idempotencyKey: _key,
          );
      if (mounted) setState(() => _sent = true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ok = _category != null && _description.text.trim().length >= 10;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: _sent
            ? Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'Signalement envoyé. Notre équipe l’examine ; vous pouvez suivre son état dans « Aide ».',
                    style: TextStyle(color: AppColors.success),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Fermer')),
                ],
              )
            : Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(widget.title, style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 4),
                  const Text(
                    'En cas de danger immédiat, appelez d’abord les secours : les numéros sont dans « Aide ».',
                    style: TextStyle(color: AppColors.textMuted),
                  ),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    initialValue: _category,
                    decoration: const InputDecoration(labelText: 'Motif'),
                    items: [
                      for (final e in reportCategoryLabel.entries) DropdownMenuItem(value: e.key, child: Text(e.value)),
                    ],
                    onChanged: (v) => setState(() => _category = v),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _description,
                    maxLength: 2000,
                    minLines: 3,
                    maxLines: 6,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(labelText: 'Que s’est-il passé ? (10 caractères minimum)'),
                  ),
                  if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.danger)),
                  const SizedBox(height: 8),
                  FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
                    onPressed: !ok || _busy ? null : _submit,
                    child: const Text('Envoyer le signalement'),
                  ),
                ],
              ),
      ),
    );
  }
}
