import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../auth/auth_session.dart';

const supportTopics = {
  'COMPTE': 'Mon compte',
  'RESERVATION': 'Une réservation',
  'PAIEMENT': 'Paiement ou remboursement',
  'CONDUCTEUR': 'Espace conducteur',
  'SECURITE': 'Sécurité',
  'AUTRE': 'Autre question',
};
const supportStatus = {'OPEN': 'En attente de l’équipe', 'ANSWERED': 'Répondu', 'CLOSED': 'Clôturé'};

class SupportMessage {
  SupportMessage.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      body = j['body'] as String,
      fromStaff = j['fromStaff'] as bool,
      author = j['author'] as String,
      at = DateTime.parse(j['createdAt'] as String);
  final String id;
  final String body;
  final bool fromStaff;
  final String author;
  final DateTime at;
}

class SupportTicket {
  SupportTicket.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      reference = j['reference'] as String,
      subject = j['subject'] as String,
      topic = j['topic'] as String,
      status = j['status'] as String,
      lastMessageAt = DateTime.parse(j['lastMessageAt'] as String),
      messages = [for (final m in (j['messages'] as List? ?? [])) SupportMessage.fromJson(m as Map<String, dynamic>)];
  final String id;
  final String reference;
  final String subject;
  final String topic;
  final String status;
  final DateTime lastMessageAt;
  final List<SupportMessage> messages;
}

/// Assistance : conversation entre le membre et l'équipe.
class SupportRepository {
  SupportRepository(this._session);
  final AuthSession _session;

  Future<List<SupportTicket>> mine() async => [
    for (final t in (await _session.send('GET', '/support/tickets'))['data'] as List) SupportTicket.fromJson(t as Map<String, dynamic>),
  ];
  Future<SupportTicket> open(String subject, String topic, String body) async =>
      SupportTicket.fromJson(await _session.send('POST', '/support/tickets', body: {'subject': subject, 'topic': topic, 'body': body}));
  Future<SupportTicket> get(String id) async => SupportTicket.fromJson(await _session.send('GET', '/support/tickets/$id'));
  Future<SupportTicket> reply(String id, String body) async =>
      SupportTicket.fromJson(await _session.send('POST', '/support/tickets/$id/messages', body: {'body': body}));
}

final supportRepositoryProvider = Provider<SupportRepository>((ref) => SupportRepository(ref.watch(authSessionProvider)));

/// Écrire à l'équipe et suivre ses demandes.
class SupportScreen extends ConsumerStatefulWidget {
  const SupportScreen({super.key});
  @override
  ConsumerState<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends ConsumerState<SupportScreen> {
  List<SupportTicket>? _list;
  String? _error;
  String _topic = 'AUTRE';
  final _subject = TextEditingController();
  final _body = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final l = await ref.read(supportRepositoryProvider).mine();
      if (mounted) setState(() => _list = l);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final t = await ref.read(supportRepositoryProvider).open(_subject.text.trim(), _topic, _body.text.trim());
      if (!mounted) return;
      _subject.clear();
      _body.clear();
      await context.push('/aide/assistance/${t.id}');
      await _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _list;
    return Scaffold(
      appBar: AppBar(title: const Text('Assistance')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Écrivez à l’équipe IvoireCovoit. Pour un problème sur un trajet précis, ouvrez plutôt une réclamation depuis la réservation.',
            style: TextStyle(color: AppColors.textMuted),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: _topic,
                    decoration: const InputDecoration(labelText: 'Thème'),
                    items: [for (final e in supportTopics.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
                    onChanged: (v) => setState(() => _topic = v ?? 'AUTRE'),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    key: const Key('support-subject'),
                    controller: _subject,
                    maxLength: 120,
                    decoration: const InputDecoration(labelText: 'Sujet'),
                    onChanged: (_) => setState(() {}),
                  ),
                  TextField(
                    key: const Key('support-body'),
                    controller: _body,
                    minLines: 3,
                    maxLines: 6,
                    maxLength: 2000,
                    decoration: const InputDecoration(labelText: 'Votre message'),
                    onChanged: (_) => setState(() {}),
                  ),
                  const Text(
                    'L’équipe ne vous demandera jamais votre code secret Mobile Money.',
                    style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                  ),
                  if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.danger)),
                  const SizedBox(height: 8),
                  FilledButton.icon(
                    onPressed: _busy || _subject.text.trim().length < 3 || _body.text.trim().isEmpty ? null : _send,
                    icon: const Icon(Icons.send),
                    label: const Text('Envoyer à l’équipe'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text('Mes demandes', style: Theme.of(context).textTheme.titleMedium),
          if (list == null)
            const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()))
          else if (list.isEmpty)
            const Padding(padding: EdgeInsets.only(top: 8), child: Text('Aucune demande pour le moment.'))
          else
            for (final t in list)
              Card(
                child: ListTile(
                  leading: Icon(t.status == 'ANSWERED' ? Icons.mark_chat_unread_outlined : Icons.chat_bubble_outline, color: AppColors.brand),
                  title: Text(t.subject),
                  subtitle: Text('${t.reference} · ${supportStatus[t.status] ?? t.status} · ${formatDay(t.lastMessageAt)}'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    await context.push('/aide/assistance/${t.id}');
                    await _load();
                  },
                ),
              ),
        ],
      ),
    );
  }
}

/// Conversation d'assistance, actualisée toutes les 20 s tant que l'écran est ouvert.
class SupportChatScreen extends ConsumerStatefulWidget {
  const SupportChatScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<SupportChatScreen> createState() => _SupportChatScreenState();
}

class _SupportChatScreenState extends ConsumerState<SupportChatScreen> {
  SupportTicket? _t;
  String? _error;
  final _text = TextEditingController();
  bool _busy = false;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 20), (_) => _load());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final t = await ref.read(supportRepositoryProvider).get(widget.id);
      if (mounted) setState(() => _t = t);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    try {
      final t = await ref.read(supportRepositoryProvider).reply(widget.id, _text.text.trim());
      _text.clear();
      if (mounted) setState(() => _t = t);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = _t;
    return Scaffold(
      appBar: AppBar(title: Text(t?.subject ?? 'Assistance')),
      body: t == null
          ? Center(child: _error != null ? Text(_error!) : const CircularProgressIndicator())
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                  child: Text(
                    '${t.reference} · ${supportTopics[t.topic] ?? t.topic} · ${supportStatus[t.status] ?? t.status}',
                    style: const TextStyle(color: AppColors.textMuted),
                  ),
                ),
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      for (final m in t.messages)
                        Align(
                          alignment: m.fromStaff ? Alignment.centerLeft : Alignment.centerRight,
                          child: Container(
                            constraints: const BoxConstraints(maxWidth: 300),
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            decoration: BoxDecoration(
                              color: m.fromStaff ? AppColors.surface : AppColors.brandSoft,
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${m.author} · ${formatTime(m.at)}',
                                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.textMuted),
                                ),
                                Text(m.body),
                              ],
                            ),
                          ),
                        ),
                      if (t.status == 'CLOSED')
                        const Text('Demande clôturée : un nouveau message la rouvre.', style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
                    ],
                  ),
                ),
                SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            key: const Key('support-reply'),
                            controller: _text,
                            minLines: 1,
                            maxLines: 4,
                            maxLength: 2000,
                            decoration: const InputDecoration(hintText: 'Votre message', counterText: ''),
                            onChanged: (_) => setState(() {}),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Envoyer',
                          onPressed: _busy || _text.text.trim().isEmpty ? null : _send,
                          icon: Icon(Icons.send, color: AppColors.brand),
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
