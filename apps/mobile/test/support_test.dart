import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:ivoirecovoit/features/support/support.dart';

class FakeSupport implements SupportRepository {
  final opened = <(String, String, String)>[];
  final replies = <String>[];
  Map<String, dynamic> ticket({List<Map<String, dynamic>> extra = const []}) => {
    'id': 't1',
    'reference': 'A-ABC123',
    'subject': 'Remboursement',
    'topic': 'PAIEMENT',
    'status': 'OPEN',
    'lastMessageAt': '2026-11-27T10:00:00.000Z',
    'messages': [
      {'id': 'm1', 'body': 'Bonjour, où en est mon remboursement ?', 'fromStaff': false, 'author': 'Awa', 'createdAt': '2026-11-27T10:00:00.000Z'},
      ...extra,
    ],
  };

  @override
  Future<List<SupportTicket>> mine() async => opened.isEmpty ? [] : [SupportTicket.fromJson(ticket())];
  @override
  Future<SupportTicket> open(String subject, String topic, String body) async {
    opened.add((subject, topic, body));
    return SupportTicket.fromJson(ticket());
  }

  @override
  Future<SupportTicket> get(String id) async => SupportTicket.fromJson(ticket());
  @override
  Future<SupportTicket> reply(String id, String body) async {
    replies.add(body);
    return SupportTicket.fromJson(ticket(extra: [
      {'id': 'm2', 'body': body, 'fromStaff': false, 'author': 'Awa', 'createdAt': '2026-11-27T10:05:00.000Z'},
    ]));
  }
}

Widget app(FakeSupport fake, String start) => ProviderScope(
  overrides: [supportRepositoryProvider.overrideWithValue(fake)],
  child: MaterialApp.router(
    routerConfig: GoRouter(
      initialLocation: start,
      routes: [
        GoRoute(path: '/aide/assistance', builder: (_, _) => const SupportScreen()),
        GoRoute(path: '/aide/assistance/:id', builder: (_, s) => SupportChatScreen(id: s.pathParameters['id']!)),
      ],
    ),
  ),
);

void main() {
  setUpAll(() => initializeDateFormatting('fr'));

  testWidgets('ouvrir une demande à l’équipe puis voir la conversation', (tester) async {
    final fake = FakeSupport();
    await tester.pumpWidget(app(fake, '/aide/assistance'));
    await tester.pumpAndSettle();
    expect(find.text('Aucune demande pour le moment.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('support-subject')), 'Remboursement');
    await tester.enterText(find.byKey(const Key('support-body')), 'Où en est mon remboursement ?');
    await tester.pump();
    await tester.tap(find.text('Envoyer à l’équipe'));
    await tester.pumpAndSettle();
    expect(fake.opened.single.$1, 'Remboursement');
    expect(find.text('Bonjour, où en est mon remboursement ?'), findsOneWidget);
  });

  testWidgets('répondre dans une conversation', (tester) async {
    final fake = FakeSupport();
    await tester.pumpWidget(app(fake, '/aide/assistance/t1'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'Merci');
    await tester.pump();
    await tester.tap(find.byTooltip('Envoyer'));
    await tester.pumpAndSettle();
    expect(fake.replies, ['Merci']);
    expect(find.text('Merci'), findsOneWidget);
  });
}
