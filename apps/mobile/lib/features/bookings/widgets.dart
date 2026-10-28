import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import 'models.dart';

/// Pastille de statut d'une réservation.
class BookingStatusChip extends StatelessWidget {
  const BookingStatusChip({super.key, required this.status, this.driver = false});
  final String status;
  final bool driver;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (bookingTone(status)) {
      BookingTone.success => (AppColors.successSoft, AppColors.success),
      BookingTone.warning => (AppColors.warningSoft, AppColors.text),
      BookingTone.danger => (AppColors.dangerSoft, AppColors.danger),
      BookingTone.muted => (AppColors.surfaceMuted, AppColors.textMuted),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(99)),
      child: Text(
        bookingStatusText(status, driver: driver),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: fg, fontWeight: FontWeight.w600),
      ),
    );
  }
}

/// Ligne « libellé … montant » d'un récapitulatif.
class AmountRow extends StatelessWidget {
  const AmountRow(this.label, this.amount, {super.key, this.strong = false});
  final String label;
  final int amount;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    final style = strong ? const TextStyle(fontWeight: FontWeight.bold) : null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(formatXof(amount), style: style),
        ],
      ),
    );
  }
}

/// Bandeau d'avertissement (fond jaune).
class NoticeBox extends StatelessWidget {
  const NoticeBox(this.text, {super.key, this.color = AppColors.warningSoft});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(10),
    decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(AppTheme.radiusControl)),
    child: Text(text),
  );
}
