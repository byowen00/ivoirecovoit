import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import 'auth_controller.dart';
import 'models.dart';

/// Après le premier code : prénom, nom et acceptation des textes. Le compte devient alors actif.
class ProfileSetupScreen extends ConsumerStatefulWidget {
  const ProfileSetupScreen({super.key, required this.me, this.next = '/compte'});
  final Me me;
  final String next;

  @override
  ConsumerState<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends ConsumerState<ProfileSetupScreen> {
  late final _first = TextEditingController(text: widget.me.firstName);
  late final _last = TextEditingController(text: widget.me.lastName);
  bool _accepted = false;
  Map<String, String> _fields = {};
  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _first.dispose();
    _last.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final local = <String, String>{
      if (_first.text.trim().isEmpty) 'firstName': 'Indiquez votre prénom.',
      if (_last.text.trim().isEmpty) 'lastName': 'Indiquez votre nom.',
      if (!_accepted) 'accept': 'Vous devez accepter les conditions pour utiliser le service.',
    };
    setState(() {
      _fields = local;
      _error = null;
    });
    if (local.isNotEmpty) return;
    setState(() => _saving = true);
    final repo = ref.read(authRepositoryProvider);
    try {
      var me = await repo.updateProfile({'firstName': _first.text.trim(), 'lastName': _last.text.trim()});
      for (final c in widget.me.requiredConsents.where((c) => !c.accepted)) {
        me = await repo.consent(c.type, c.version, true);
      }
      ref.read(authControllerProvider.notifier).setMe(me);
      if (mounted) context.go(widget.next);
    } on ApiException catch (e) {
      setState(() {
        _fields = e.fields;
        _error = e.fields.isEmpty ? e.message : null;
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final version = widget.me.requiredConsents.firstOrNull?.version ?? '';
    return Scaffold(
      appBar: AppBar(title: const Text('Votre profil')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Faisons connaissance', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            const Text('Seuls votre prénom et l’initiale de votre nom seront visibles des autres membres.'),
            const SizedBox(height: 16),
            TextField(
              key: const Key('first-name'),
              controller: _first,
              textCapitalization: TextCapitalization.words,
              autofillHints: const [AutofillHints.givenName],
              decoration: InputDecoration(labelText: 'Prénom', errorText: _fields['firstName']),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('last-name'),
              controller: _last,
              textCapitalization: TextCapitalization.words,
              autofillHints: const [AutofillHints.familyName],
              decoration: InputDecoration(labelText: 'Nom', errorText: _fields['lastName']),
            ),
            const SizedBox(height: 12),
            CheckboxListTile(
              key: const Key('accept-terms'),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _accepted,
              onChanged: (v) => setState(() => _accepted = v ?? false),
              title: Text(
                  'J’accepte les conditions générales d’utilisation et la politique de confidentialité (version $version).'),
              subtitle: const Text('Textes en cours de rédaction : ils seront validés par un juriste avant le lancement.'),
            ),
            if (_fields['accept'] != null)
              Text(_fields['accept']!, style: const TextStyle(color: AppColors.danger)),
            if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.danger)),
            const SizedBox(height: 16),
            FilledButton(onPressed: _saving ? null : _submit, child: Text(_saving ? 'Enregistrement…' : 'Continuer')),
          ],
        ),
      ),
    );
  }
}
