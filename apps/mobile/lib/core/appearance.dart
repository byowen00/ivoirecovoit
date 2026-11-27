import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';
import 'theme.dart';
import 'ui.dart' show TripKindChoice;

const _cacheKey = 'appearance';

/// Apparence réglée dans l'administration (« Interface et design ») : palette, accueil, menu de recherche.
class Appearance {
  const Appearance({
    this.theme = 'ORANGE',
    this.homeLayout = 'CARTE',
    this.defaultTripKind = 'ALL',
    this.showPopularRoutes = true,
    this.liveDrivers = true,
    this.colors,
  });

  factory Appearance.fromJson(Map<String, dynamic> j) {
    final c = j['colors'];
    return Appearance(
      theme: j['theme'] as String? ?? 'ORANGE',
      homeLayout: j['homeLayout'] == 'CLASSIQUE' ? 'CLASSIQUE' : 'CARTE',
      defaultTripKind: j['defaultTripKind'] as String? ?? 'ALL',
      showPopularRoutes: j['showPopularRoutes'] as bool? ?? true,
      liveDrivers: j['liveDrivers'] as bool? ?? true,
      colors: c is Map ? {for (final e in c.entries) '${e.key}': '${e.value}'} : null,
    );
  }

  final String theme;
  final String homeLayout;
  final String defaultTripKind;
  final bool showPopularRoutes;

  /// Conducteurs en circulation sur la carte de l'accueil (réglage de l'administration).
  final bool liveDrivers;
  final Map<String, String>? colors;

  bool get mapHome => homeLayout != 'CLASSIQUE';
  TripKindChoice get tripKind => TripKindChoice.of(defaultTripKind == 'ALL' ? null : defaultTripKind);

  Map<String, dynamic> toJson() => {
    'theme': theme,
    'homeLayout': homeLayout,
    'defaultTripKind': defaultTripKind,
    'showPopularRoutes': showPopularRoutes,
    'liveDrivers': liveDrivers,
    'colors': ?colors,
  };

  /// Applique la palette aux couleurs de l'appli ; une couleur mal formée garde la valeur actuelle.
  void applyColors() {
    final c = colors;
    if (c == null) return;
    Color pick(String key, Color current) {
      final m = RegExp(r'^#([0-9a-fA-F]{6})$').firstMatch(c[key] ?? '');
      return m == null ? current : Color(0xFF000000 | int.parse(m.group(1)!, radix: 16));
    }

    AppColors.apply(
      brand: pick('brand', AppColors.brand),
      brandStrong: pick('brandStrong', AppColors.brandStrong),
      brandSoft: pick('brandSoft', AppColors.brandSoft),
      accent: pick('accent', AppColors.accent),
      night: pick('night', AppColors.night),
    );
  }
}

/// Dernière apparence connue (gardée sur le téléphone), puis mise à jour depuis le serveur au démarrage.
class AppearanceNotifier extends Notifier<Appearance> {
  @override
  Appearance build() {
    var look = const Appearance();
    try {
      final raw = ref.read(sharedPreferencesProvider).getString(_cacheKey);
      if (raw != null) look = Appearance.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {}
    look.applyColors();
    Future.microtask(refresh);
    return look;
  }

  Future<void> refresh() async {
    try {
      final j = await ref.read(apiClientProvider).get('/app/appearance', retries: 0);
      final next = Appearance.fromJson(j);
      final raw = jsonEncode(next.toJson());
      final prefs = ref.read(sharedPreferencesProvider);
      if (prefs.getString(_cacheKey) == raw) return;
      await prefs.setString(_cacheKey, raw);
      next.applyColors();
      state = next;
    } catch (_) {
      // Serveur injoignable : on garde l'apparence connue.
    }
  }
}

final appearanceProvider = NotifierProvider<AppearanceNotifier, Appearance>(AppearanceNotifier.new);
