import 'package:flutter/material.dart';

import 'format.dart';
import 'theme.dart';

/// Petits éléments visuels partagés par les écrans (maquettes design v2).

/// Pastille arrondie : « Vérifié », « 2 places », « [DEMO] »…
class Pill extends StatelessWidget {
  const Pill(this.label, {super.key, this.tone = PillTone.neutral, this.icon});
  final String label;
  final PillTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      PillTone.success => (AppColors.successSoft, const Color(0xFF0B5A3A)),
      PillTone.brand => (AppColors.brandSoft, const Color(0xFF8A3C05)),
      PillTone.warning => (AppColors.warningSoft, const Color(0xFF6B4E00)),
      PillTone.neutral => (const Color(0xFFF0F1EE), const Color(0xFF3A454B)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 14, color: fg), const SizedBox(width: 4)],
          Text(
            label,
            style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

enum PillTone { neutral, success, brand, warning }

/// Repère de départ (rond orange) ou d'arrivée (carré vert) des frises de trajet.
class RouteMark extends StatelessWidget {
  const RouteMark.origin({super.key, this.size = 10}) : origin = true;
  const RouteMark.destination({super.key, this.size = 10}) : origin = false;
  final bool origin;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: origin
        ? BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.brand, width: size / 4),
          )
        : BoxDecoration(color: AppColors.success, borderRadius: BorderRadius.circular(size / 4)),
  );
}

/// Frise verticale départ → arrivée, à placer entre deux lignes de texte.
class RouteLine extends StatelessWidget {
  const RouteLine({super.key});

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 6),
    child: Column(
      children: [
        RouteMark.origin(size: 9),
        Expanded(
          child: SizedBox(width: 2, child: ColoredBox(color: AppColors.border)),
        ),
        RouteMark.destination(size: 9),
      ],
    ),
  );
}

/// Montant en grands chiffres, « FCFA » en petit.
class PriceText extends StatelessWidget {
  const PriceText(this.amount, {super.key, this.size = 20, this.color = AppColors.text});
  final int amount;
  final double size;
  final Color color;

  static String digits(int n) => n.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ' ');

  @override
  Widget build(BuildContext context) => Text.rich(
    TextSpan(
      text: formatXofDigits(amount),
      children: [
        TextSpan(
          text: ' FCFA',
          style: TextStyle(fontSize: size * 0.6, fontWeight: FontWeight.w700),
        ),
      ],
    ),
    style: TextStyle(
      fontFamily: AppTheme.displayFont,
      fontWeight: FontWeight.w800,
      fontSize: size,
      color: color,
      fontFeatures: const [FontFeature.tabularFigures()],
    ),
  );
}

/// Titre de section en Manrope.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(
          text,
          style: const TextStyle(fontFamily: AppTheme.displayFont, fontWeight: FontWeight.w700, fontSize: 18),
        ),
      ),
      ?trailing,
    ],
  );
}

/// Bouton de choix rapide (Aujourd'hui, Demain, tri…) : plein quand il est choisi.
class ChoiceButton extends StatelessWidget {
  const ChoiceButton({super.key, required this.label, required this.selected, required this.onTap, this.icon});
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Semantics(
    selected: selected,
    button: true,
    child: Material(
      color: selected ? AppColors.night : AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: selected ? BorderSide.none : const BorderSide(color: AppColors.border, width: 1.5),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          alignment: Alignment.center,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 16, color: selected ? Colors.white : AppColors.text),
                const SizedBox(width: 6),
              ],
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                    color: selected ? Colors.white : AppColors.text,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

/// Bouton rond de 44 dp (−, +, retour…).
class RoundButton extends StatelessWidget {
  const RoundButton({super.key, required this.icon, required this.tooltip, this.onPressed});
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: tooltip,
    onPressed: onPressed,
    icon: Icon(icon, size: 20),
    style: IconButton.styleFrom(
      fixedSize: const Size(44, 44),
      backgroundColor: AppColors.surface,
      foregroundColor: AppColors.text,
      side: const BorderSide(color: AppColors.border, width: 1.5),
    ),
  );
}
