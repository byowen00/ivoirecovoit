import '../../core/api_client.dart';

class Place {
  const Place({required this.id, required this.kind, required this.label, required this.lat, required this.lng,
      required this.isApproximate});

  factory Place.fromJson(Map<String, dynamic> json) => Place(
        id: json['id'] as String,
        kind: json['kind'] as String,
        label: json['label'] as String,
        lat: (json['lat'] as num).toDouble(),
        lng: (json['lng'] as num).toDouble(),
        isApproximate: json['locationPrecision'] == 'APPROX',
      );

  final String id;
  final String kind;
  final String label;
  final double lat;
  final double lng;
  final bool isApproximate;

  String get kindLabel => const {
        'CITY': 'Ville',
        'COMMUNE': 'Commune',
        'NEIGHBORHOOD': 'Quartier',
        'LANDMARK': 'Lieu',
        'STATION': 'Gare',
      }[kind] ??
      '';
}

abstract class PlacesRepository {
  Future<List<Place>> autocomplete(String query);
}

class ApiPlacesRepository implements PlacesRepository {
  ApiPlacesRepository(this._api);
  final ApiClient _api;

  @override
  Future<List<Place>> autocomplete(String query) async {
    final res = await _api.get('/places/autocomplete', query: {'q': query, 'limit': '6'}, retries: 1);
    return (res['data'] as List<dynamic>).map((e) => Place.fromJson(e as Map<String, dynamic>)).toList();
  }
}
