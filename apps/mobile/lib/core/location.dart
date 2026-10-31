import 'package:geolocator/geolocator.dart';

/// Position du téléphone refusée ou indisponible ; [message] est prêt à afficher.
class LocationUnavailable implements Exception {
  const LocationUnavailable(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Position approximative du téléphone, demandée seulement quand la personne touche « Ma position ».
/// La position n'est ni stockée ni envoyée ailleurs que dans la recherche.
Future<({double lat, double lng})> currentPosition() async {
  if (!await Geolocator.isLocationServiceEnabled()) {
    throw const LocationUnavailable('Activez la localisation du téléphone, puis réessayez.');
  }
  var permission = await Geolocator.checkPermission();
  if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
  if (permission == LocationPermission.denied) {
    throw const LocationUnavailable('Sans accès à votre position, choisissez le départ dans la liste.');
  }
  if (permission == LocationPermission.deniedForever) {
    throw const LocationUnavailable(
      'L’accès à la position est bloqué pour IvoireCovoit. Autorisez-le dans les réglages du téléphone.',
    );
  }
  try {
    final p = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.low, timeLimit: Duration(seconds: 15)),
    );
    return (lat: p.latitude, lng: p.longitude);
  } on Exception {
    throw const LocationUnavailable('Position introuvable pour le moment. Réessayez ou choisissez le départ.');
  }
}
