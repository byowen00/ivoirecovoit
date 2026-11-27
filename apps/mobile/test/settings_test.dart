import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ivoirecovoit/core/appearance.dart';
import 'package:ivoirecovoit/core/theme.dart';
import 'package:ivoirecovoit/features/settings/settings_screen.dart';

void main() {
  test('palette personnelle : prend le pas sur celle de l’administration', () {
    final before = AppColors.brand;
    final look = Appearance.fromJson({
      'theme': 'ORANGE',
      'colors': {'brand': '#c0560a', 'night': '#11181c'},
      'themes': {
        'ORANGE': {'label': 'Orange et vert (par défaut)', 'brand': '#c0560a', 'night': '#11181c'},
        'VIOLET': {'label': 'Violet', 'brand': '#6d28d9', 'night': '#1e1530'},
      },
    });
    expect(look.themes.keys, ['ORANGE', 'VIOLET']);
    look.applyColors(override: 'VIOLET');
    expect(AppColors.brand, const Color(0xFF6D28D9));
    expect(Appearance.fromJson(look.toJson()).themes['VIOLET']?['label'], 'Violet');
    look.applyColors(override: 'INCONNU'); // palette absente : celle de l'administration
    expect(AppColors.brand, before);
  });

  test('embouteillages : alerte de l’équipe et heures de pointe', () {
    final t = TrafficInfo.fromJson({
      'alert': {'note': 'Pont HKB fermé', 'until': '2026-11-27T20:00:00.000Z'},
      'peakNow': true,
      'peakHours': [
        {'days': [1, 2, 3, 4, 5], 'from': '06:30', 'to': '09:00'},
      ],
      'source': 'Informations saisies par l’équipe, pas de mesure en temps réel.',
    });
    expect(t.hasAlert, isTrue);
    expect(t.alertNote, 'Pont HKB fermé');
    expect(t.windows.single.from, '06:30');
    expect(TrafficInfo.fromJson({'alert': null, 'peakHours': []}).hasAlert, isFalse);
    expect(daysLabel([1, 2, 3, 4, 5]), 'lun. à ven.');
    expect(daysLabel([6, 7]), 'sam., dim.');
  });
}
