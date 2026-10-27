import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/theme.dart';
import 'places_repository.dart';

/// Champ de saisie d'un lieu avec suggestions (ville, commune, quartier).
/// Les requêtes partent après une courte pause de frappe pour économiser les données mobiles.
class PlaceField extends StatefulWidget {
  const PlaceField({
    super.key,
    required this.label,
    required this.repository,
    required this.onSelected,
    this.debounce = const Duration(milliseconds: 300),
  });

  final String label;
  final PlacesRepository repository;
  final ValueChanged<Place?> onSelected;
  final Duration debounce;

  @override
  State<PlaceField> createState() => _PlaceFieldState();
}

class _PlaceFieldState extends State<PlaceField> {
  final _controller = TextEditingController();
  Timer? _timer;
  int _requestId = 0;
  List<Place> _items = const [];
  bool _loading = false;
  String? _error;
  bool _searched = false;
  Place? _selected;

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String text) {
    if (_selected != null) {
      _selected = null;
      widget.onSelected(null);
    }
    _timer?.cancel();
    final q = text.trim();
    if (q.length < 2) {
      setState(() {
        _items = const [];
        _loading = false;
        _error = null;
        _searched = false;
      });
      return;
    }
    _timer = Timer(widget.debounce, () => _search(q));
  }

  Future<void> _search(String q) async {
    final id = ++_requestId;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await widget.repository.autocomplete(q);
      if (!mounted || id != _requestId) return; // réponse périmée : une saisie plus récente est en cours
      setState(() {
        _items = items;
        _searched = true;
      });
    } on ApiException catch (e) {
      if (!mounted || id != _requestId) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted && id == _requestId) setState(() => _loading = false);
    }
  }

  void _select(Place place) {
    _timer?.cancel();
    _requestId++;
    _controller.text = place.label;
    setState(() {
      _selected = place;
      _items = const [];
      _searched = false;
      _loading = false;
    });
    widget.onSelected(place);
    FocusScope.of(context).unfocus();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _controller,
          onChanged: _onChanged,
          textInputAction: TextInputAction.next,
          decoration: InputDecoration(
            labelText: widget.label,
            hintText: 'Ville, commune ou quartier',
            suffixIcon: _loading
                ? const Padding(
                    padding: EdgeInsets.all(14),
                    child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                  )
                : null,
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(_error!, style: theme.textTheme.bodySmall?.copyWith(color: AppColors.danger)),
          ),
        if (_searched && _items.isEmpty && _error == null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text('Aucun lieu trouvé. Essayez le nom de la ville ou de la commune.',
                style: theme.textTheme.bodySmall?.copyWith(color: AppColors.textMuted)),
          ),
        if (_items.isNotEmpty)
          Card(
            margin: const EdgeInsets.only(top: 4),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (final place in _items)
                  ListTile(
                    minTileHeight: 48,
                    title: Text(place.label),
                    trailing: Text(place.kindLabel, style: theme.textTheme.bodySmall),
                    onTap: () => _select(place),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
