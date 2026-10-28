import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../core/config.dart';
import '../../core/theme.dart';

enum PointTone { origin, destination, stop, result }

class MapPoint {
  const MapPoint(this.point, this.label, this.tone, {this.id});
  final LatLng point;
  final String label;
  final PointTone tone;
  final String? id;
}

const _toneColor = {
  PointTone.origin: AppColors.success,
  PointTone.destination: AppColors.brand,
  PointTone.stop: AppColors.textMuted,
  PointTone.result: Color(0xFF1D5FD6),
};

/// Carte du trajet (tuiles configurables, attribution OpenStreetMap). Le tracé est une estimation, pas un suivi GPS.
class TripMap extends StatelessWidget {
  const TripMap({
    super.key,
    required this.points,
    this.route = const [],
    this.height = 240,
    this.onSelect,
    required this.semanticLabel,
  });

  final List<MapPoint> points;
  final List<LatLng> route;
  final double height;
  final ValueChanged<String>? onSelect;
  final String semanticLabel;

  @override
  Widget build(BuildContext context) {
    final all = [...points.map((p) => p.point), ...route];
    final MapOptions options;
    if (all.length >= 2) {
      options = MapOptions(
        initialCameraFit: CameraFit.coordinates(coordinates: all, padding: const EdgeInsets.all(32), maxZoom: 14),
        interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
      );
    } else {
      options = MapOptions(
        initialCenter: all.firstOrNull ?? const LatLng(7.54, -5.55),
        initialZoom: all.isEmpty ? 6 : 12,
      );
    }
    return Semantics(
      label: semanticLabel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(AppTheme.radiusCard),
            child: SizedBox(
              height: height,
              child: FlutterMap(
                options: options,
                children: [
                  TileLayer(urlTemplate: AppConfig.tileUrl, userAgentPackageName: 'ci.ivoirecovoit.app'),
                  if (route.length > 1)
                    PolylineLayer(
                      polylines: [
                        Polyline(
                          points: route,
                          color: AppColors.brand.withValues(alpha: 0.8),
                          strokeWidth: 4,
                          pattern: StrokePattern.dashed(segments: const [8, 6]),
                        ),
                      ],
                    ),
                  MarkerLayer(
                    markers: [
                      for (final p in points)
                        Marker(
                          point: p.point,
                          width: 28,
                          height: 28,
                          child: GestureDetector(
                            onTap: p.id != null && onSelect != null ? () => onSelect!(p.id!) : null,
                            child: Tooltip(
                              message: p.label,
                              child: Center(
                                child: Container(
                                  width: p.tone == PointTone.stop ? 14 : 18,
                                  height: p.tone == PointTone.stop ? 14 : 18,
                                  decoration: BoxDecoration(
                                    color: _toneColor[p.tone],
                                    shape: BoxShape.circle,
                                    border: Border.all(color: Colors.white, width: 2),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                  const RichAttributionWidget(attributions: [TextSourceAttribution(AppConfig.tileAttribution)]),
                ],
              ),
            ),
          ),
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text(
              'Tracé indicatif, ce n’est pas un suivi GPS.',
              style: TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
          ),
        ],
      ),
    );
  }
}
