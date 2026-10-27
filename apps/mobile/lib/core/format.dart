import 'package:intl/intl.dart';

final _xof = NumberFormat.decimalPattern('fr');

/// Montant en francs CFA : « 5 300 FCFA ». Les montants sont toujours des entiers.
String formatXof(int amount) => '${_xof.format(amount)} FCFA';

/// Durée estimée : « env. 2 h 45 ».
String formatDuration(int seconds) {
  final totalMinutes = ((seconds / 60) / 5).round() * 5;
  final h = totalMinutes ~/ 60;
  final m = totalMinutes % 60;
  if (h == 0) return 'env. $m min';
  return m == 0 ? 'env. $h h' : 'env. $h h ${m.toString().padLeft(2, '0')}';
}
