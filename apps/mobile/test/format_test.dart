import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:ivoirecovoit/core/format.dart';

void main() {
  setUpAll(() => initializeDateFormatting('fr'));

  test('formate les montants en FCFA sans décimales', () {
    expect(formatXof(5300).replaceAll(RegExp(r'\s'), ' '), '5 300 FCFA');
  });

  test('arrondit les durées estimées à 5 minutes', () {
    expect(formatDuration(9900), 'env. 2 h 45');
    expect(formatDuration(1800), 'env. 30 min');
  });
}
