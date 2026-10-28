import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:ivoirecovoit/features/trust/chat_screen.dart';
import 'package:ivoirecovoit/features/trust/dispute_screens.dart';
import 'package:ivoirecovoit/features/trust/help_screen.dart';
import 'package:ivoirecovoit/features/trust/models.dart';
import 'package:ivoirecovoit/features/trust/notifications_screen.dart';
import 'package:ivoirecovoit/features/trust/report_sheet.dart';
import 'package:ivoirecovoit/providers.dart';

import 'trust_fakes.dart';

Widget app(FakeTrust fake, Widget screen) => ProviderScope(
  overrides: [trustRepositoryProvider.overrideWithValue(fake)],
  child: MaterialApp.router(
    routerConfig: GoRouter(
      initialLocation: '/r',
      routes: [
        GoRoute(path: '/r', builder: (_, _) => screen),
        GoRoute(path: '/reservations/:id', builder: (_, s) => Text('réservation ${s.pathParameters['id']}')),
        GoRoute(path: '/aide/reclamations/:id', builder: (_, s) => Text('suivi ${s.pathParameters['id']}')),
        GoRoute(path: '/compte', builder: (_, _) => const Text('compte')),
      ],
    ),
  ),
);

void main() {
  setUpAll(() => initializeDateFormatting('fr'));

  group('partage et liens', () {
    test('message de partage : horaires estimés, sans GPS', () {
      final m = shareMessage('https://x.ci/partage/abc', 'Cocody → Bouaké');
      expect(m, contains('horaires estimés, pas de position GPS'));
      expect(smsUri(m).toString(), startsWith('sms:?body=Je%20voyage'));
    });

    test('une notification ne mène qu’à un écran de l’application', () {
      expect(internalLink('/reservations/b1'), '/reservations/b1');
      expect(internalLink('https://exemple.com'), isNull);
      expect(internalLink('//exemple.com'), isNull);
      expect(internalLink(null), isNull);
    });
  });

  testWidgets('écran 13 : notification non lue, ouverture et marquage', (tester) async {
    final fake = FakeTrust();
    await tester.pumpWidget(app(fake, const NotificationsScreen()));
    await tester.pumpAndSettle();
    expect(find.text('Réservation confirmée'), findsOneWidget);
    expect(find.byIcon(Icons.circle), findsOneWidget); // pastille « non lue »
    await tester.tap(find.text('Réservation confirmée'));
    await tester.pumpAndSettle();
    expect(find.text('réservation b1'), findsOneWidget);
    expect(fake.read, ['n1']);
  });

  testWidgets('messagerie : coordonnées masquées annoncées, envoi', (tester) async {
    final fake = FakeTrust();
    await tester.pumpWidget(app(fake, const ChatScreen(bookingId: 'b1')));
    await tester.pumpAndSettle();
    expect(find.text('Messages avec Koffi'), findsOneWidget);
    expect(find.textContaining('sont masqués tant que la réservation'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Je serai devant la pharmacie.');
    await tester.tap(find.byTooltip('Envoyer'));
    await tester.pumpAndSettle();
    expect(fake.sent, ['Je serai devant la pharmacie.']);
    expect(find.text('Je serai devant la pharmacie.'), findsOneWidget);
  });

  testWidgets('signalement : motif et 10 caractères obligatoires', (tester) async {
    final fake = FakeTrust();
    await tester.pumpWidget(
      app(
        fake,
        const Scaffold(
          body: ReportForm(targetType: 'USER', targetId: 'u1', bookingId: 'b1', title: 'Signaler le conducteur'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final send = find.widgetWithText(FilledButton, 'Envoyer le signalement');
    await tester.tap(find.text('Motif'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Conduite dangereuse').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Court');
    await tester.pump();
    expect(tester.widget<FilledButton>(send).onPressed, isNull);
    await tester.enterText(find.byType(TextField), 'Excès de vitesse sur l’autoroute du Nord');
    await tester.pump();
    await tester.tap(send);
    await tester.pumpAndSettle();
    expect(fake.reports.single['category'], 'DANGEROUS_DRIVING');
    expect(find.textContaining('Signalement envoyé'), findsOneWidget);
  });

  testWidgets('écran 16 : nouvelle réclamation puis suivi', (tester) async {
    final fake = FakeTrust();
    await tester.pumpWidget(app(fake, const NewDisputeScreen(bookingId: 'b1')));
    await tester.pumpAndSettle();
    final send = find.widgetWithText(FilledButton, 'Envoyer la réclamation');
    expect(tester.widget<FilledButton>(send).onPressed, isNull);
    await tester.tap(find.text('Retard important'));
    await tester.enterText(find.byType(TextField), 'Arrivé avec 45 minutes de retard.');
    await tester.pump();
    await tester.tap(send);
    await tester.pumpAndSettle();
    expect(fake.disputes.single, ('b1', 'DRIVER_LATE', 'Arrivé avec 45 minutes de retard.'));
    expect(find.text('suivi d1'), findsOneWidget);
  });

  testWidgets('écran 16 : suivi d’une réclamation et réponse', (tester) async {
    final fake = FakeTrust();
    await tester.pumpWidget(app(fake, const DisputeScreen(disputeId: 'd1')));
    await tester.pumpAndSettle();
    expect(find.text('Réclamation R-ABCDEF'), findsOneWidget);
    expect(find.text('En attente de la réponse de l’autre partie'), findsOneWidget);
    expect(find.text('Nous examinons votre demande.'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Voici la capture du message.');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Envoyer'));
    await tester.pumpAndSettle();
    expect(fake.sent, ['Voici la capture du message.']);
  });

  testWidgets('écran 16 : numéros d’urgence signalés comme à valider', (tester) async {
    await tester.pumpWidget(app(FakeTrust(), const HelpScreen()));
    await tester.pumpAndSettle();
    expect(find.text('Numéros d’urgence'), findsOneWidget);
    expect(find.text('Numéros à faire valider avant la mise en service.'), findsOneWidget);
    expect(find.text('110'), findsOneWidget);
  });
}
