import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../core/config.dart';
import '../../core/theme.dart';

/// Choisir un point sur la carte : on déplace la carte sous le repère central, puis « Choisir ce point ».
/// Le point est ensuite rattaché au lieu connu le plus proche (pas de donnée géographique inventée).
class MapPickerScreen extends StatefulWidget {
  const MapPickerScreen({super.key, required this.title, this.initial});
  final String title;
  final LatLng? initial;

  @override
  State<MapPickerScreen> createState() => _MapPickerScreenState();
}

class _MapPickerScreenState extends State<MapPickerScreen> {
  final _map = MapController();
  late LatLng _center = widget.initial ?? const LatLng(5.345, -4.024); // Abidjan par défaut

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Stack(
        children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(
              initialCenter: _center,
              initialZoom: widget.initial == null ? 11 : 13,
              interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
              onPositionChanged: (camera, _) => _center = camera.center,
              onTap: (_, point) => _map.move(point, _map.camera.zoom),
            ),
            children: [
              TileLayer(urlTemplate: AppConfig.tileUrl, userAgentPackageName: 'ci.ivoirecovoit.app'),
              RichAttributionWidget(attributions: [TextSourceAttribution(AppConfig.tileAttribution)]),
            ],
          ),
          // Repère fixe au centre : c'est la carte qui bouge.
          IgnorePointer(
            child: Center(
              child: Padding(
                padding: EdgeInsets.only(bottom: 40),
                child: Icon(Icons.location_on, size: 44, color: AppColors.brand),
              ),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 24,
            child: SafeArea(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(12)),
                    child: const Text(
                      'Déplacez la carte ou touchez un endroit. Le lieu connu le plus proche sera retenu.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: 8),
                  FilledButton.icon(
                    key: const Key('map-pick-confirm'),
                    onPressed: () => Navigator.pop(context, _center),
                    icon: const Icon(Icons.check),
                    label: const Text('Choisir ce point'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
