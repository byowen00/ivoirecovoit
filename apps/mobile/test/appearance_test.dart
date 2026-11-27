import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ivoirecovoit/core/appearance.dart';
import 'package:ivoirecovoit/core/theme.dart';
import 'package:ivoirecovoit/core/ui.dart';

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
}
