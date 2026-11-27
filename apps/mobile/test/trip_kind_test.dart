import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ivoirecovoit/core/ui.dart';
import 'package:ivoirecovoit/features/home/home_screen.dart';
import 'package:ivoirecovoit/features/trips/search_results_screen.dart';
import 'package:ivoirecovoit/features/trips/trips_repository.dart';

void main() {
  const base = SearchQuery(fromId: 'a', fromLabel: 'Abidjan', toId: 'b', toLabel: 'Bouaké');

  test('menu interurbain : le type passe dans l’adresse et la requête', () {
    final q = queryFromUri(Uri.parse(resultsLocation(base.copyWith(kindChoice: TripKindChoice.intercity))))!;
    expect(q.kind, 'INTERCITY');
    expect(q.toParams()['kind'], 'INTERCITY');
    expect(q.copyWith(kindChoice: TripKindChoice.all).toParams().containsKey('kind'), isFalse);
    expect(queryFromUri(Uri.parse('/recherche?from=a&to=b&kind=AUTRE'))!.kind, isNull);
    // Gamme du véhicule (Éco, Confort, Luxe).
    final lux = queryFromUri(Uri.parse(resultsLocation(base.copyWith(comfortChoice: ComfortChoice.luxe))))!;
    expect(lux.toParams()['comfort'], 'LUXE');
    expect(queryFromUri(Uri.parse('/recherche?from=a&to=b&comfort=PREMIUM'))!.comfort, isNull);
  });

  testWidgets('menu Tous / En ville / Interurbain', (tester) async {
    var value = TripKindChoice.all;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) => Column(
              children: [
                TripKindMenu(value: value, onChanged: (k) => setState(() => value = k)),
                const TripKindBadge('URBAN'),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.byKey(const Key('kind-intercity')));
    await tester.pump();
    expect(value, TripKindChoice.intercity);
    expect(find.textContaining('Entre deux villes'), findsOneWidget);
    expect(find.byIcon(Icons.airport_shuttle), findsOneWidget);
    expect(find.text('En ville'), findsNWidgets(2)); // bouton du menu + pastille
  });

  test('conducteurs en circulation : lecture de la carte, rien si désactivé', () {
    final on = parseLiveDrivers({
      'enabled': true,
      'data': [
        {'tripId': 't1', 'kind': 'INTERCITY', 'toLabel': 'Bouaké', 'lat': 5.3355, 'lng': -4.0275, 'ageS': 4},
      ],
    });
    expect(on.single.tripId, 't1');
    expect(on.single.point.latitude, 5.3355);
    expect(parseLiveDrivers({'enabled': false, 'data': []}), isEmpty);
  });

  test('menu déroulant de l’accueil : tout est regroupé', () {
    final out = homeMenuEntries(signedIn: false).map((e) => e.path).toList();
    expect(out, containsAll(['/reservations', '/historique', '/conducteur/publier', '/aide', '/statut', '/compte']));
    expect(out, isNot(contains('/notifications')));
    expect(homeMenuEntries(signedIn: true).map((e) => e.path), contains('/notifications'));
  });
}
