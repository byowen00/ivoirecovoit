import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';
import 'theme.dart';
import 'ui.dart' show TripKindChoice;

const _cacheKey = 'appearance';
const personalThemeKey = 'appearance.mine';
const _textScaleKey = 'appearance.text_scale';

/// Apparence réglée dans l'administration (« Interface et design ») : palette, accueil, menu de recherche.
class Appearance {
  const Appearance({
    this.theme = 'ORANGE',
    this.homeLayout = 'CARTE',
    this.defaultTripKind = 'ALL',
    this.showPopularRoutes = true,
    this.liveDrivers = true,
    this.colors,
    this.themes = const {},
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
      themes: {
        if (j['themes'] case final Map t)
          for (final e in t.entries)
            if (e.value case final Map v) '${e.key}': {for (final x in v.entries) '${x.key}': '${x.value}'},
      },
    );
  }

  final String theme;
  final String homeLayout;
  final String defaultTripKind;
  final bool showPopularRoutes;

  /// Conducteurs en circulation sur la carte de l'accueil (réglage de l'administration).
  final bool liveDrivers;
  final Map<String, String>? colors;

  /// Palettes proposées (avec leur libellé), pour le choix personnel dans « Paramètres ».
  final Map<String, Map<String, String>> themes;

  bool get mapHome => homeLayout != 'CLASSIQUE';
  TripKindChoice get tripKind => TripKindChoice.of(defaultTripKind == 'ALL' ? null : defaultTripKind);

  Map<String, dynamic> toJson() => {
    'theme': theme,
    'homeLayout': homeLayout,
    'defaultTripKind': defaultTripKind,
    'showPopularRoutes': showPopularRoutes,
    'liveDrivers': liveDrivers,
    'colors': ?colors,
    if (themes.isNotEmpty) 'themes': themes,
  };

  /// Applique la palette aux couleurs de l'appli ; une couleur mal formée garde la valeur actuelle.
  /// [override] : palette choisie par la personne dans « Paramètres » (sinon celle de l'administration).
  void applyColors({String? override}) {
    final c = (override != null ? themes[override] : null) ?? colors;
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
    look.applyColors(override: _mine());
    Future.microtask(refresh);
    return look;
  }

  String? _mine() => ref.read(sharedPreferencesProvider).getString(personalThemeKey);

  Future<void> refresh() async {
    try {
      final j = await ref.read(apiClientProvider).get('/app/appearance', retries: 0);
      final next = Appearance.fromJson(j);
      final raw = jsonEncode(next.toJson());
      final prefs = ref.read(sharedPreferencesProvider);
      if (prefs.getString(_cacheKey) == raw) return;
      await prefs.setString(_cacheKey, raw);
      next.applyColors(override: _mine());
      state = next;
    } catch (_) {
      // Serveur injoignable : on garde l'apparence connue.
    }
  }
}

final appearanceProvider = NotifierProvider<AppearanceNotifier, Appearance>(AppearanceNotifier.new);

/// Réglages d'affichage propres à ce téléphone : palette personnelle et taille du texte.
class PersonalLook {
  const PersonalLook({this.theme, this.textScale = 1});
  final String? theme;
  final double textScale;
}

class PersonalLookNotifier extends Notifier<PersonalLook> {
  @override
  PersonalLook build() {
    final prefs = ref.read(sharedPreferencesProvider);
    return PersonalLook(theme: prefs.getString(personalThemeKey), textScale: prefs.getDouble(_textScaleKey) ?? 1);
  }

  /// null : suivre la palette choisie par IvoireCovoit.
  Future<void> setTheme(String? theme) async {
    final prefs = ref.read(sharedPreferencesProvider);
    theme == null ? await prefs.remove(personalThemeKey) : await prefs.setString(personalThemeKey, theme);
    ref.read(appearanceProvider).applyColors(override: theme);
    state = PersonalLook(theme: theme, textScale: state.textScale);
  }

  Future<void> setTextScale(double scale) async {
    await ref.read(sharedPreferencesProvider).setDouble(_textScaleKey, scale);
    state = PersonalLook(theme: state.theme, textScale: scale);
  }
}

final personalLookProvider = NotifierProvider<PersonalLookNotifier, PersonalLook>(PersonalLookNotifier.new);
