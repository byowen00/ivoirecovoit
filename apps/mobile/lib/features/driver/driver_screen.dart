import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/upload.dart';
import '../../providers.dart';
import '../trips/trips_repository.dart';
import 'driver_repository.dart';

const _uploadErrors = {
  'UPLOAD_INVALID': 'Le fichier reçu ne correspond pas (format, taille ou contenu). Réessayez avec une autre photo.',
  'UPLOAD_MISSING': 'Le fichier n’est pas arrivé. Vérifiez votre connexion puis réessayez.',
  'DOSSIER_LOCKED': 'Ce dossier est en cours de vérification : les pièces ne peuvent plus être modifiées.',
};

/// Choisit une photo (appareil photo ou galerie) et la prépare pour le dépôt. null si annulé.
Future<UploadFile?> pickDocument(BuildContext context, {int maxBytes = maxDocumentBytes, bool allowPdf = true}) async {
  final source = await showModalBottomSheet<ImageSource>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined),
            title: const Text('Prendre une photo'),
            onTap: () => Navigator.pop(ctx, ImageSource.camera),
          ),
          ListTile(
            leading: const Icon(Icons.photo_library_outlined),
            title: const Text('Choisir dans la galerie'),
            onTap: () => Navigator.pop(ctx, ImageSource.gallery),
          ),
        ],
      ),
    ),
  );
  if (source == null) return null;
  // Compression raisonnable pour les réseaux mobiles, en gardant le texte des pièces lisible.
  final image = await ImagePicker().pickImage(source: source, maxWidth: 2000, imageQuality: 85);
  if (image == null) return null;
  return prepareFile(await image.readAsBytes(), maxBytes: maxBytes, allowPdf: allowPdf);
}

/// Espace conducteur : permis, pièces, véhicules, état de la vérification.
class DriverScreen extends ConsumerStatefulWidget {
  const DriverScreen({super.key});
  @override
  ConsumerState<DriverScreen> createState() => _DriverScreenState();
}

class _DriverScreenState extends ConsumerState<DriverScreen> {
  bool _loading = true;
  DriverProfile? _profile;
  List<Vehicle> _vehicles = const [];
  String? _error;
  String _identity = 'NATIONAL_ID';

  DriverRepository get _repo => ref.read(driverRepositoryProvider);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final p = await _repo.me();
      final v = p == null ? <Vehicle>[] : await _repo.vehicles();
      if (!mounted) return;
      setState(() {
        _profile = p;
        _vehicles = v;
        _loading = false;
        _identity = p?.documents.where((d) => d.docType != 'DRIVING_LICENSE').firstOrNull?.docType ?? _identity;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.status == 401 ? 'Connectez-vous pour accéder à l’espace conducteur.' : e.message;
        _loading = false;
      });
    }
  }

  void _toast(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<bool> _guard(Future<void> Function() fn) async {
    try {
      await fn();
      await _load();
      return true;
    } on ApiException catch (e) {
      _toast(_uploadErrors[e.code] ?? e.message);
      return false;
    }
  }

  Future<void> _upload(Future<void> Function(UploadFile f) send) async {
    try {
      final f = await pickDocument(context);
      if (f == null) return;
      if (await _guard(() => send(f)) && mounted) _toast('Pièce envoyée.');
    } on ApiException catch (e) {
      _toast(e.message); // fichier refusé avant envoi (format, taille)
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _profile;
    return Scaffold(
      appBar: AppBar(title: const Text('Espace conducteur')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_error!),
                  TextButton(
                    onPressed: () => context.push('/connexion?next=/conducteur'),
                    child: const Text('Se connecter'),
                  ),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (p != null)
                    Text('Dossier : ${verificationLabel[p.status]}', style: Theme.of(context).textTheme.titleMedium),
                  if (p != null && p.canPublish)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            const Text(
                              '✓ Vous pouvez publier des trajets.',
                              style: TextStyle(color: AppColors.success),
                            ),
                            FilledButton(
                              onPressed: () => context.push('/conducteur/publier'),
                              child: const Text('Publier un trajet'),
                            ),
                            OutlinedButton(
                              onPressed: () => context.push('/conducteur/trajets'),
                              child: const Text('Mes trajets'),
                            ),
                            OutlinedButton(
                              onPressed: () => context.push('/paiements?onglet=gains'),
                              child: const Text('Mes gains'),
                            ),
                          ],
                        ),
                      ),
                    )
                  else if (p != null)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Avant de publier :'),
                            for (final b in p.publishBlockers)
                              Text('• ${blockerLabel[b] ?? b}', style: const TextStyle(color: AppColors.textMuted)),
                          ],
                        ),
                      ),
                    ),
                  _LicenseCard(profile: p, onSaved: _load),
                  if (p != null) _documentsCard(p),
                  if (p != null) ...[for (final v in _vehicles) _vehicleCard(v), _AddVehicle(onAdded: _load)],
                  const SizedBox(height: 12),
                  const Text(
                    'Vos pièces sont stockées de façon privée et ne sont jamais visibles des autres membres. Seule l’équipe de vérification peut les consulter, et chaque consultation est enregistrée.',
                    style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _docTile(String label, DocInfo? doc, {required bool enabled, required VoidCallback onPick}) {
    final status = doc == null ? 'Non déposé' : verificationLabel[doc.status] ?? doc.status;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(label),
      subtitle: Text(
        [
          status,
          if (doc?.expiresOn != null) 'expire le ${doc!.expiresOn!.split('-').reversed.join('/')}',
          if (doc?.rejectionReason != null) 'motif : ${doc!.rejectionReason}',
        ].join(' · '),
        style: TextStyle(
          color: doc?.status == 'REJECTED'
              ? AppColors.danger
              : doc?.status == 'APPROVED'
              ? AppColors.success
              : AppColors.textMuted,
        ),
      ),
      trailing: enabled ? TextButton(onPressed: onPick, child: Text(doc == null ? 'Ajouter' : 'Remplacer')) : null,
    );
  }

  Widget _documentsCard(DriverProfile p) {
    final twoSided = _identity != 'PASSPORT';
    Future<void> up(String type, String side) => _upload((f) => _repo.uploadDriverDocument(f, type, side));
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Pièces justificatives', style: Theme.of(context).textTheme.titleMedium),
            if (p.status == 'REJECTED' && p.rejectionReason != null)
              Text('Dossier refusé : ${p.rejectionReason}', style: const TextStyle(color: AppColors.danger)),
            for (final r in p.requirements)
              Text(
                '${r.done ? '✓' : '○'} ${requirementLabel[r.key] ?? r.key}',
                style: TextStyle(color: r.done ? AppColors.success : AppColors.textMuted),
              ),
            _docTile(
              'Permis (recto)',
              p.doc('DRIVING_LICENSE', 'FRONT'),
              enabled: p.canEdit,
              onPick: () => up('DRIVING_LICENSE', 'FRONT'),
            ),
            _docTile(
              'Permis (verso)',
              p.doc('DRIVING_LICENSE', 'BACK'),
              enabled: p.canEdit,
              onPick: () => up('DRIVING_LICENSE', 'BACK'),
            ),
            DropdownButtonFormField<String>(
              initialValue: _identity,
              decoration: const InputDecoration(labelText: 'Pièce d’identité'),
              items: const [
                DropdownMenuItem(value: 'NATIONAL_ID', child: Text('Carte nationale d’identité')),
                DropdownMenuItem(value: 'PASSPORT', child: Text('Passeport')),
                DropdownMenuItem(value: 'CONSULAR_CARD', child: Text('Carte consulaire')),
              ],
              onChanged: p.canEdit ? (v) => setState(() => _identity = v!) : null,
            ),
            _docTile(
              twoSided ? 'Recto' : 'Page d’identité',
              p.doc(_identity, 'FRONT'),
              enabled: p.canEdit,
              onPick: () => up(_identity, 'FRONT'),
            ),
            if (twoSided)
              _docTile('Verso', p.doc(_identity, 'BACK'), enabled: p.canEdit, onPick: () => up(_identity, 'BACK')),
            if (p.canEdit)
              FilledButton(
                onPressed: p.canSubmit ? () => _guard(() async => _repo.submit()) : null,
                child: const Text('Envoyer mon dossier pour vérification'),
              ),
            if (p.status == 'PENDING')
              const Text(
                'Votre dossier est en cours de vérification par notre équipe.',
                style: TextStyle(color: AppColors.textMuted),
              ),
          ],
        ),
      ),
    );
  }

  Widget _vehicleCard(Vehicle v) {
    Future<void> up(String type, {bool expiry = false}) async {
      String? expiresOn;
      if (expiry) {
        final now = DateTime.now();
        final d = await showDatePicker(
          context: context,
          helpText: 'Date d’expiration du document',
          initialDate: now.add(const Duration(days: 180)),
          firstDate: now.add(const Duration(days: 1)),
          lastDate: now.add(const Duration(days: 365 * 10)),
        );
        if (d == null) return;
        expiresOn = isoDay(DateTime.utc(d.year, d.month, d.day));
      }
      if (!mounted) return;
      await _upload((f) => _repo.uploadVehicleDocument(v.id, f, type, expiresOn: expiresOn));
    }

    // Un véhicule validé peut recevoir une assurance ou une visite renouvelée.
    final renewable = v.editable || v.status == 'APPROVED';
    return Card(
      child: ExpansionTile(
        initiallyExpanded: v.editable,
        title: Text('${v.make} ${v.model} · ${v.plateNumber}'),
        subtitle: Text(
          verificationLabel[v.status] ?? v.status,
          style: TextStyle(
            color: v.status == 'APPROVED'
                ? AppColors.success
                : v.status == 'REJECTED'
                ? AppColors.danger
                : AppColors.textMuted,
          ),
        ),
        childrenPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        children: [
          if (v.rejectionReason != null)
            Text('Motif du refus : ${v.rejectionReason}', style: const TextStyle(color: AppColors.danger)),
          _docTile(
            'Carte grise',
            v.doc('VEHICLE_REGISTRATION'),
            enabled: v.editable,
            onPick: () => up('VEHICLE_REGISTRATION'),
          ),
          _docTile('Assurance', v.doc('INSURANCE'), enabled: renewable, onPick: () => up('INSURANCE', expiry: true)),
          _docTile(
            'Visite technique',
            v.doc('TECHNICAL_INSPECTION'),
            enabled: renewable,
            onPick: () => up('TECHNICAL_INSPECTION', expiry: true),
          ),
          _docTile(
            'Photo du véhicule (facultatif)',
            v.doc('VEHICLE_PHOTO'),
            enabled: v.editable,
            onPick: () => up('VEHICLE_PHOTO'),
          ),
          if (v.editable)
            FilledButton(
              onPressed: v.canSubmit ? () => _guard(() async => _repo.submitVehicle(v.id)) : null,
              child: const Text('Envoyer le véhicule pour vérification'),
            ),
        ],
      ),
    );
  }
}

class _LicenseCard extends ConsumerStatefulWidget {
  const _LicenseCard({required this.profile, required this.onSaved});
  final DriverProfile? profile;
  final Future<void> Function() onSaved;
  @override
  ConsumerState<_LicenseCard> createState() => _LicenseCardState();
}

class _LicenseCardState extends ConsumerState<_LicenseCard> {
  final _number = TextEditingController();
  DateTime? _expires;
  Map<String, String> _fields = const {};
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _number.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _fields = const {};
      _error = null;
    });
    try {
      await ref.read(driverRepositoryProvider).saveLicense(_number.text, isoDay(_expires!));
      _number.clear();
      await widget.onSaved();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.fields.isNotEmpty) {
          _fields = e.fields;
        } else {
          _error = e.message;
        }
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.profile;
    final editable = p == null || p.canEdit;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              p == null ? 'Devenir conducteur' : 'Permis de conduire',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (p == null)
              const Text('Commencez par votre permis. Vous ajouterez ensuite vos pièces et votre véhicule.'),
            if (p?.licenseMasked != null)
              Text(
                'Permis n° ${p!.licenseMasked}, valable jusqu’au ${p.licenseExpiresOn!.split('-').reversed.join('/')}',
              ),
            if (editable) ...[
              const SizedBox(height: 8),
              TextField(
                controller: _number,
                textCapitalization: TextCapitalization.characters,
                decoration: InputDecoration(labelText: 'Numéro de permis', errorText: _fields['licenseNumber']),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                icon: const Icon(Icons.event),
                label: Text(
                  _expires == null
                      ? 'Date d’expiration'
                      : 'Expire le ${isoDay(_expires!).split('-').reversed.join('/')}',
                ),
                onPressed: () async {
                  final now = DateTime.now();
                  final d = await showDatePicker(
                    context: context,
                    initialDate: now.add(const Duration(days: 365)),
                    firstDate: now.add(const Duration(days: 1)),
                    lastDate: now.add(const Duration(days: 365 * 20)),
                  );
                  if (d != null) setState(() => _expires = DateTime.utc(d.year, d.month, d.day));
                },
              ),
              if (_fields['licenseExpiresOn'] case final e?) Text(e, style: const TextStyle(color: AppColors.danger)),
              if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.danger)),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: _busy || _expires == null ? null : _save,
                child: Text(_busy ? 'Enregistrement…' : 'Enregistrer'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _AddVehicle extends ConsumerStatefulWidget {
  const _AddVehicle({required this.onAdded});
  final Future<void> Function() onAdded;
  @override
  ConsumerState<_AddVehicle> createState() => _AddVehicleState();
}

class _AddVehicleState extends ConsumerState<_AddVehicle> {
  bool _open = false;
  final _make = TextEditingController();
  final _model = TextEditingController();
  final _color = TextEditingController();
  final _plate = TextEditingController();
  int _seats = 3;
  Map<String, String> _fields = const {};
  String? _error;
  // Même clé pour les nouvelles tentatives de ce formulaire : pas de véhicule en double.
  String _key = newIdempotencyKey();

  @override
  void dispose() {
    for (final c in [_make, _model, _color, _plate]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _fields = const {};
      _error = null;
    });
    try {
      await ref.read(driverRepositoryProvider).addVehicle({
        'make': _make.text.trim(),
        'model': _model.text.trim(),
        'color': _color.text.trim(),
        'plateNumber': _plate.text,
        'seatsCapacity': _seats,
      }, _key);
      _key = newIdempotencyKey();
      setState(() => _open = false);
      await widget.onAdded();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.fields.isNotEmpty) {
          _fields = e.fields;
        } else {
          _error = e.message;
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_open) {
      return Align(
        alignment: Alignment.centerLeft,
        child: TextButton.icon(
          onPressed: () => setState(() => _open = true),
          icon: const Icon(Icons.add),
          label: const Text('Ajouter un véhicule'),
        ),
      );
    }
    Widget field(
      TextEditingController c,
      String label,
      String key, {
      TextCapitalization cap = TextCapitalization.words,
    }) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: TextField(
        controller: c,
        textCapitalization: cap,
        decoration: InputDecoration(labelText: label, errorText: _fields[key]),
      ),
    );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Nouveau véhicule', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            field(_make, 'Marque', 'make'),
            field(_model, 'Modèle', 'model'),
            field(_color, 'Couleur', 'color'),
            field(_plate, 'Immatriculation (ex. 1234 AB 01)', 'plateNumber', cap: TextCapitalization.characters),
            DropdownButtonFormField<int>(
              initialValue: _seats,
              decoration: const InputDecoration(labelText: 'Places passagers'),
              items: [for (var n = 1; n <= 8; n++) DropdownMenuItem(value: n, child: Text('$n'))],
              onChanged: (n) => setState(() => _seats = n ?? 3),
            ),
            if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.danger)),
            const SizedBox(height: 8),
            FilledButton(onPressed: _save, child: const Text('Ajouter le véhicule')),
          ],
        ),
      ),
    );
  }
}
