import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import 'models.dart';
import 'report_sheet.dart';

/// Messagerie d'une réservation, entre le passager et le conducteur.
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.bookingId});
  final String bookingId;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  Conversation? _c;
  String? _error;
  bool _sending = false;
  final _text = TextEditingController();
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    // Pas encore de push : la conversation se rafraîchit toutes les 10 s tant que l'écran est ouvert.
    _poll = Timer.periodic(const Duration(seconds: 10), (_) => _load());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final c = await ref.read(trustRepositoryProvider).conversation(widget.bookingId);
      if (mounted) setState(() => _c = c);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _send() async {
    final body = _text.text.trim();
    if (body.isEmpty) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref.read(trustRepositoryProvider).sendMessage(widget.bookingId, body);
      _text.clear();
      await _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    final muted = Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMuted);
    return Scaffold(
      appBar: AppBar(
        title: Text(
          c == null
              ? 'Messages'
              : 'Messages avec ${c.otherName ?? (c.otherRole == 'DRIVER' ? 'le conducteur' : 'le passager')}',
        ),
      ),
      body: c == null
          ? Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!))
          : Column(
              children: [
                if (c.contactsMasked)
                  Container(
                    width: double.infinity,
                    color: AppColors.warningSoft,
                    padding: const EdgeInsets.all(12),
                    child: const Text(
                      'Les numéros et adresses e-mail sont masqués tant que la réservation n’est pas confirmée.',
                    ),
                  ),
                Expanded(
                  child: ListView(
                    reverse: true,
                    padding: const EdgeInsets.all(16),
                    children: [
                      for (final m in c.messages.reversed)
                        Align(
                          alignment: m.mine ? Alignment.centerRight : Alignment.centerLeft,
                          child: Container(
                            constraints: const BoxConstraints(maxWidth: 300),
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: m.mine ? AppColors.brandSoft : AppColors.surfaceMuted,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(m.hidden ? 'Message masqué par la modération.' : m.body),
                                const SizedBox(height: 2),
                                Wrap(
                                  crossAxisAlignment: WrapCrossAlignment.center,
                                  children: [
                                    Text(
                                      '${formatDay(m.createdAt)} ${formatTime(m.createdAt)}${m.wasRedacted ? ' · coordonnées masquées' : ''}',
                                      style: muted,
                                    ),
                                    if (!m.mine && !m.hidden)
                                      TextButton(
                                        style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                                        onPressed: () => showReportSheet(
                                          context,
                                          targetType: 'MESSAGE',
                                          targetId: m.id,
                                          bookingId: widget.bookingId,
                                          title: 'Signaler ce message',
                                        ),
                                        child: const Text('Signaler'),
                                      ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                      if (c.messages.isEmpty)
                        const Center(child: Text('Aucun message. Présentez-vous et précisez le point de rendez-vous.')),
                    ],
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(_error!, style: const TextStyle(color: AppColors.danger)),
                  ),
                SafeArea(
                  child: c.canSend
                      ? Padding(
                          padding: const EdgeInsets.all(8),
                          child: Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _text,
                                  maxLength: 1000,
                                  minLines: 1,
                                  maxLines: 4,
                                  decoration: const InputDecoration(labelText: 'Votre message', counterText: ''),
                                ),
                              ),
                              IconButton(
                                tooltip: 'Envoyer',
                                onPressed: _sending ? null : _send,
                                icon: const Icon(Icons.send),
                              ),
                            ],
                          ),
                        )
                      : Padding(
                          padding: const EdgeInsets.all(16),
                          child: Text(c.closedReason ?? 'La conversation est close.', style: muted),
                        ),
                ),
              ],
            ),
    );
  }
}
