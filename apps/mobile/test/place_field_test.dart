import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ivoirecovoit/core/api_client.dart';
import 'package:ivoirecovoit/features/places/place_field.dart';
import 'package:ivoirecovoit/features/places/places_repository.dart';

class FakePlaces implements PlacesRepository {
  FakePlaces({this.fail = false});
  final bool fail;
  final queries = <String>[];

  @override
  Future<List<Place>> autocomplete(String query) async {
    queries.add(query);
    if (fail) throw ApiException('NETWORK_ERROR', 'Connexion impossible. Vérifiez votre réseau puis réessayez.');
    return const [
      Place(id: 'p1', kind: 'CITY', label: 'Yamoussoukro', lat: 6.83, lng: -5.29, isApproximate: true),
    ];
  }

  final reversed = <(double, double)>[];
  Place? nearest =
      const Place(id: 'p2', kind: 'NEIGHBORHOOD', label: 'Cocody, Abidjan', lat: 5.35, lng: -3.99, isApproximate: false);

  @override
  Future<Place?> reverse(double lat, double lng) async {
    reversed.add((lat, lng));
    return nearest;
  }
}

Widget wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('affiche les suggestions puis remonte le lieu choisi', (tester) async {
    final repo = FakePlaces();
    Place? selected;
    await tester.pumpWidget(wrap(PlaceField(
      label: 'Arrivée',
      repository: repo,
      debounce: Duration.zero,
      onSelected: (p) => selected = p,
    )));

    await tester.enterText(find.byType(TextField), 'yamous');
    await tester.pumpAndSettle();
    expect(repo.queries, ['yamous']);
    expect(find.text('Ville'), findsOneWidget);

    await tester.tap(find.widgetWithText(ListTile, 'Yamoussoukro'));
    await tester.pumpAndSettle();
    expect(selected?.id, 'p1');
    expect(find.byType(ListTile), findsNothing);
    expect(find.textContaining('Aucun lieu trouvé'), findsNothing);
  });

  testWidgets("n'interroge pas l'API avant 2 caractères", (tester) async {
    final repo = FakePlaces();
    await tester.pumpWidget(wrap(PlaceField(label: 'Départ', repository: repo, debounce: Duration.zero, onSelected: (_) {})));
    await tester.enterText(find.byType(TextField), 'y');
    await tester.pumpAndSettle();
    expect(repo.queries, isEmpty);
  });

  testWidgets('affiche un message clair si le réseau est coupé', (tester) async {
    await tester.pumpWidget(wrap(PlaceField(
        label: 'Départ', repository: FakePlaces(fail: true), debounce: Duration.zero, onSelected: (_) {})));
    await tester.enterText(find.byType(TextField), 'bouake');
    await tester.pumpAndSettle();
    expect(find.textContaining('Connexion impossible'), findsOneWidget);
  });

  testWidgets('choisir sur la carte retient le lieu connu le plus proche', (tester) async {
    final repo = FakePlaces();
    Place? selected;
    await tester.pumpWidget(wrap(PlaceField(label: 'Départ', repository: repo, onSelected: (p) => selected = p)));
    await tester.tap(find.byKey(const Key('map-pick-Départ')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('map-pick-confirm')));
    await tester.pumpAndSettle();
    expect(repo.reversed, hasLength(1));
    expect(selected?.id, 'p2');
    expect(find.text('Cocody, Abidjan'), findsOneWidget);
  });

  testWidgets('point loin de tout lieu connu : message clair, rien de choisi', (tester) async {
    final repo = FakePlaces()..nearest = null;
    Place? selected;
    await tester.pumpWidget(wrap(PlaceField(label: 'Arrivée', repository: repo, onSelected: (p) => selected = p)));
    await tester.tap(find.byKey(const Key('map-pick-Arrivée')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('map-pick-confirm')));
    await tester.pumpAndSettle();
    expect(selected, isNull);
    expect(find.textContaining('Aucun lieu connu près de ce point'), findsOneWidget);
  });
}
