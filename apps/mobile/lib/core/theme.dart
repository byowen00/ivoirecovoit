import 'package:flutter/material.dart';

/// Jetons du système de design, alignés sur l'application web (apps/web/app/globals.css).
/// Modifier une couleur ici change toute l'application.
class AppColors {
  static const brand = Color(0xFFC0560A); // texte blanc dessus : contraste 4,6:1
  static const brandStrong = Color(0xFF9A4407);
  static const brandSoft = Color(0xFFFFF0E3);
  static const accent = Color(0xFFF08A2C); // décoratif uniquement (logo sur fond sombre)
  static const success = Color(0xFF0B6B45);
  static const successSoft = Color(0xFFE3F2EA);
  static const online = Color(0xFF22C55E); // pastille « connecté »
  static const danger = Color(0xFFB42318);
  static const dangerSoft = Color(0xFFFDECEA);
  static const warningSoft = Color(0xFFFFF7D6);
  static const text = Color(0xFF11181C);
  static const textMuted = Color(0xFF4A555C);
  static const night = Color(0xFF11181C); // en-têtes sombres
  static const nightMuted = Color(0xFFC9D0D4);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceMuted = Color(0xFFF4F5F2);
  static const border = Color(0xFFDDE1DC);
}

class AppTheme {
  static const radiusControl = 14.0;
  static const radiusCard = 20.0;

  /// Police des titres ; le texte courant est en Inter (assets/fonts, licence OFL).
  static const displayFont = 'Manrope';

  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.brand,
      primary: AppColors.brand,
      onPrimary: Colors.white,
      secondary: AppColors.success,
      onSecondary: Colors.white,
      error: AppColors.danger,
      surface: AppColors.surface,
      onSurface: AppColors.text,
      onSurfaceVariant: AppColors.textMuted,
      outline: AppColors.border,
    );
    final controlShape = OutlineInputBorder(
      borderRadius: BorderRadius.circular(radiusControl),
      borderSide: const BorderSide(color: AppColors.border, width: 1.5),
    );
    const display = TextStyle(fontFamily: displayFont, color: AppColors.text, letterSpacing: -0.3);
    final base = ThemeData(useMaterial3: true, colorScheme: scheme, fontFamily: 'Inter');
    return base.copyWith(
      scaffoldBackgroundColor: AppColors.surfaceMuted,
      textTheme: base.textTheme.copyWith(
        headlineLarge: display.copyWith(fontSize: 32, fontWeight: FontWeight.w800),
        headlineMedium: display.copyWith(fontSize: 28, fontWeight: FontWeight.w800),
        headlineSmall: display.copyWith(fontSize: 24, fontWeight: FontWeight.w800),
        titleLarge: display.copyWith(fontSize: 20, fontWeight: FontWeight.w700),
        titleMedium: display.copyWith(fontSize: 17, fontWeight: FontWeight.w700),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.surfaceMuted,
        foregroundColor: AppColors.text,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        titleTextStyle: TextStyle(fontFamily: displayFont, fontSize: 19, fontWeight: FontWeight.w700, color: AppColors.text),
      ),
      cardTheme: CardThemeData(
        color: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusCard)),
      ),
      chipTheme: const ChipThemeData(
        shape: StadiumBorder(),
        side: BorderSide.none,
        labelStyle: TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
      ),
      dividerTheme: const DividerThemeData(color: AppColors.border, space: 1),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        border: controlShape,
        enabledBorder: controlShape,
        focusedBorder: controlShape.copyWith(borderSide: const BorderSide(color: AppColors.brand, width: 2)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(52), // cible tactile ≥ 48 dp
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusControl)),
          textStyle: const TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          foregroundColor: AppColors.text,
          side: const BorderSide(color: AppColors.text, width: 1.5),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusControl)),
          textStyle: const TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: AppColors.night),
    );
  }

  // Le mode sombre est prévu : ajouter ThemeData dark() ici, sans toucher aux écrans.
}
