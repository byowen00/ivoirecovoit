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

/// Distance indicative : « env. 240 km ».
String formatDistance(int meters) =>
    meters < 1000 ? 'env. ${(meters / 50).round() * 50} m' : 'env. ${(meters / 1000).round()} km';

// Abidjan est à UTC+0 toute l'année : l'heure UTC est l'heure locale.
final _time = DateFormat('HH:mm', 'fr');
final _day = DateFormat('EEE d MMM', 'fr');

/// Heure à Abidjan : « 07:30 ».
String formatTime(DateTime d) => _time.format(d.toUtc());

/// Jour à Abidjan : « jeu. 29 oct. ».
String formatDay(DateTime d) => _day.format(d.toUtc());

/// Date ISO (AAAA-MM-JJ) à l'heure d'Abidjan.
String isoDay(DateTime d) => d.toUtc().toIso8601String().substring(0, 10);
