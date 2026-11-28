import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'appearance.dart';
import 'theme.dart';

/// Taille (en points) du marqueur de véhicule selon le réglage de l'administration.
double vehicleMarkerSize(String size) => switch (size) {
  'PETIT' => 26,
  'GRAND' => 44,
  _ => 34,
};

/// Icône effective : AUTO choisit la voiture en ville et le minibus en interurbain.
IconData? vehicleIconData(String icon, {String? kind}) => switch (icon) {
  'POINT' => null,
  'TAXI' => Icons.local_taxi,
  'MINIBUS' => Icons.airport_shuttle,
  'VOITURE' => Icons.directions_car_filled,
  _ => kind == 'INTERCITY' ? Icons.airport_shuttle : Icons.directions_car_filled,
};

Color vehicleMarkerColor(Appearance look) {
  final m = RegExp(r'^#([0-9a-fA-F]{6})$').firstMatch(look.vehicleHex ?? '');
  // « Couleur de la palette » suit aussi la palette personnelle choisie dans Paramètres.
  if (look.vehicleColor == 'MARQUE' || m == null) return AppColors.brand;
  return Color(0xFF000000 | int.parse(m.group(1)!, radix: 16));
}

/// Véhicule sur une carte (accueil, suivi du trajet), tel que réglé dans « Interface et design ».
class VehicleMapMarker extends ConsumerWidget {
  const VehicleMapMarker({super.key, this.kind, this.highlight = false});
  final String? kind;
  final bool highlight;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final look = ref.watch(appearanceProvider);
    final size = vehicleMarkerSize(look.vehicleSize) + (highlight ? 8 : 0);
    final icon = vehicleIconData(look.vehicleIcon, kind: kind);
    final dot = icon == null ? size * 0.55 : size;
    return Center(
      child: Container(
        width: dot,
        height: dot,
        decoration: BoxDecoration(
          color: vehicleMarkerColor(look),
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 2),
          boxShadow: const [BoxShadow(color: Color(0x59000000), blurRadius: 4, offset: Offset(0, 1))],
        ),
        child: icon == null
            ? null
            : Icon(icon, size: size * 0.6, color: icon == Icons.local_taxi ? const Color(0xFFFFD400) : Colors.white),
      ),
    );
  }
}
