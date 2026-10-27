import 'package:flutter/material.dart';

/// Jetons du système de design, alignés sur l'application web (apps/web/app/globals.css).
class AppColors {
  static const brand = Color(0xFFB85400); // texte blanc dessus : contraste 5,0:1
  static const brandStrong = Color(0xFF8F4100);
  static const brandSoft = Color(0xFFFFF1E5);
  static const accent = Color(0xFFF77F00); // décoratif uniquement
  static const success = Color(0xFF00704A);
  static const successSoft = Color(0xFFE6F4EE);
  static const danger = Color(0xFFB42318);
  static const dangerSoft = Color(0xFFFDECEA);
  static const warningSoft = Color(0xFFFFF7D6);
  static const text = Color(0xFF1B1F24);
  static const textMuted = Color(0xFF545C66);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceMuted = Color(0xFFF5F6F8);
  static const border = Color(0xFFD5D9DE);
}

class AppTheme {
  static const radiusControl = 10.0;
  static const radiusCard = 14.0;

  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.brand,
      primary: AppColors.brand,
      onPrimary: Colors.white,
      error: AppColors.danger,
      surface: AppColors.surface,
      onSurface: AppColors.text,
    );
    final controlShape = OutlineInputBorder(
      borderRadius: BorderRadius.circular(radiusControl),
      borderSide: const BorderSide(color: AppColors.border),
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: AppColors.surfaceMuted,
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        border: controlShape,
        enabledBorder: controlShape,
        focusedBorder: controlShape.copyWith(borderSide: const BorderSide(color: AppColors.brand, width: 2)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(48), // cible tactile ≥ 48 dp
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusControl)),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusControl)),
        ),
      ),
    );
  }

  // Le mode sombre est prévu : ajouter ThemeData dark() ici, sans toucher aux écrans.
}
