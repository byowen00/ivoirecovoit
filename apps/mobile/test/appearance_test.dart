import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ivoirecovoit/core/appearance.dart';
import 'package:ivoirecovoit/core/theme.dart';
import 'package:ivoirecovoit/core/ui.dart';
import 'package:ivoirecovoit/core/vehicle_marker.dart';

void main() {
  test('apparence réglée par l’admin : palette, accueil et menu par défaut', () {
    final before = AppColors.brand;
    final look = Appearance.fromJson({
      'theme': 'BLEU',
      'homeLayout': 'CLASSIQUE',
      'defaultTripKind': 'INTERCITY',
      'showPopularRoutes': false,
      'colors': {'brand': '#1d4ed8', 'night': '#0f172a', 'accent': 'pas une couleur'},
    });
    expect(look.mapHome, isFalse);
    expect(look.tripKind, TripKindChoice.intercity);
    final accent = AppColors.accent;
    look.applyColors();
    expect(AppColors.brand, const Color(0xFF1D4ED8));
    expect(AppColors.night, const Color(0xFF0F172A));
    expect(AppColors.accent, accent); // couleur mal formée ignorée
    expect(Appearance.fromJson(look.toJson()).theme, 'BLEU');
    Appearance.fromJson({'colors': {'brand': '#c0560a', 'night': '#11181c'}}).applyColors();
    expect(AppColors.brand, before);
    expect(const Appearance().mapHome, isTrue);
  });

  test('véhicules sur la carte : icône, couleur et taille réglées par l’admin', () {
    final look = Appearance.fromJson({'vehicleIcon': 'TAXI', 'vehicleColor': 'VERT', 'vehicleHex': '#0b6b45', 'vehicleSize': 'GRAND'});
    expect(vehicleIconData(look.vehicleIcon), Icons.local_taxi);
    expect(vehicleMarkerColor(look), const Color(0xFF0B6B45));
    expect(vehicleMarkerSize(look.vehicleSize), 44);
    expect(Appearance.fromJson(look.toJson()).vehicleIcon, 'TAXI');
    expect(vehicleIconData('AUTO', kind: 'INTERCITY'), Icons.airport_shuttle);
    expect(vehicleIconData('POINT'), isNull);
    expect(vehicleMarkerColor(const Appearance()), AppColors.brand); // couleur de la palette
  });
}
