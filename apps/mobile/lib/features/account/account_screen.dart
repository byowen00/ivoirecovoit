import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/theme.dart';
import '../trust/notifications_screen.dart';
import '../../providers.dart';
import '../auth/auth_controller.dart';
import '../auth/models.dart';
import '../auth/otp_field.dart';
import '../../core/upload.dart';
import '../driver/driver_screen.dart';
import '../trips/trip_detail_screen.dart';

const _optionalConsentVersion = '1';
final _dateTime = DateFormat("d MMM y 'à' HH:mm", 'fr');

void _toast(BuildContext context, String message) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

/// Écran 15 : données, préférences, consentements, contact d'urgence, appareils, suppression.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Mon compte')),
      body: SafeArea(
        child: auth.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, _) => const Center(child: Text('Chargement impossible.')),
          data: (me) {
            if (me == null) return const _SignedOut();
            if (!me.profileComplete) {
              return Center(
                child: FilledButton(
                  onPressed: () => context.go('/inscription/profil'),
                  child: const Text('Compléter mon profil'),
                ),
              );
            }
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(me.displayName ?? '', style: Theme.of(context).textTheme.headlineSmall),
                Text('${formatE164(me.phone)}${me.isDemo ? '  [DEMO]' : ''}',
                    style: const TextStyle(color: AppColors.textMuted)),
                const SizedBox(height: 12),
                _PhotoCard(me: me),
                _ProfileCard(me: me),
                _PreferencesCard(me: me),
                const NotificationPreferencesCard(),
                _ConsentsCard(me: me),
                const _EmergencyCard(),
                const _SessionsCard(),
                const _DeleteCard(),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Photo de profil : dépôt contrôlé par le serveur, visible des autres membres.
class _PhotoCard extends ConsumerStatefulWidget {
  const _PhotoCard({required this.me});
  final Me me;
  @override
  ConsumerState<_PhotoCard> createState() => _PhotoCardState();
}

class _PhotoCardState extends ConsumerState<_PhotoCard> {
  bool _busy = false;

  Future<void> _run(Future<Map<String, dynamic>> Function() fn) async {
    setState(() => _busy = true);
    try {
      ref.read(authControllerProvider.notifier).setMe(Me.fromJson(await fn()));
    } on ApiException catch (e) {
      if (mounted) _toast(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _change() async {
    final session = ref.read(authSessionProvider);
    try {
      final file = await pickDocument(context, maxBytes: maxPhotoBytes, allowPdf: false);
      if (file == null) return;
      await _run(() async {
        final res = await session.send('POST', '/me/photo/upload-url', body: file.meta);
        await putSigned(res['upload'] as Map<String, dynamic>, file);
        return session.send('POST', '/me/photo/complete');
      });
    } on ApiException catch (e) {
      if (mounted) _toast(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = widget.me;
    return Card(
      child: ListTile(
        leading: Avatar(name: me.displayName ?? '?', url: me.photoUrl, radius: 26),
        title: const Text('Photo de profil'),
        subtitle: const Text('Visible des autres membres. JPEG, PNG ou WebP, 5 Mo maximum.'),
        trailing: PopupMenuButton<String>(
          enabled: !_busy,
          tooltip: 'Modifier la photo',
          onSelected: (v) => v == 'change' ? _change() : _run(() => ref.read(authSessionProvider).send('DELETE', '/me/photo')),
          itemBuilder: (_) => [
            PopupMenuItem(value: 'change', child: Text(me.photoUrl == null ? 'Ajouter une photo' : 'Changer de photo')),
            if (me.photoUrl != null) const PopupMenuItem(value: 'remove', child: Text('Retirer la photo')),
          ],
        ),
      ),
    );
  }
}

class _SignedOut extends StatelessWidget {
  const _SignedOut();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Connectez-vous pour accéder à votre compte.', textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(onPressed: () => context.push('/connexion'), child: const Text('Se connecter')),
          ],
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
            ),
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      ),
    );
  }
}

class _ProfileCard extends ConsumerStatefulWidget {
  const _ProfileCard({required this.me});
  final Me me;

  @override
  ConsumerState<_ProfileCard> createState() => _ProfileCardState();
}

class _ProfileCardState extends ConsumerState<_ProfileCard> {
  late final _first = TextEditingController(text: widget.me.firstName);
  late final _last = TextEditingController(text: widget.me.lastName);
  late final _email = TextEditingController(text: widget.me.email);
  late final _bio = TextEditingController(text: widget.me.bio);
  Map<String, String> _fields = {};
  bool _saving = false;

  @override
  void dispose() {
    for (final c in [_first, _last, _email, _bio]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _fields = {};
    });
    try {
      final me = await ref.read(authRepositoryProvider).updateProfile({
        'firstName': _first.text.trim(),
        'lastName': _last.text.trim(),
        'email': _email.text.trim().isEmpty ? null : _email.text.trim(),
        'bio': _bio.text.trim().isEmpty ? null : _bio.text.trim(),
      });
      ref.read(authControllerProvider.notifier).setMe(me);
      if (mounted) _toast(context, 'Informations enregistrées.');
    } on ApiException catch (e) {
      setState(() => _fields = e.fields);
      if (e.fields.isEmpty && mounted) _toast(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _Section(title: 'Mes informations', children: [
      TextField(controller: _first, decoration: InputDecoration(labelText: 'Prénom', errorText: _fields['firstName'])),
      const SizedBox(height: 8),
      TextField(controller: _last, decoration: InputDecoration(labelText: 'Nom', errorText: _fields['lastName'])),
      const SizedBox(height: 8),
      TextField(
        controller: _email,
        keyboardType: TextInputType.emailAddress,
        decoration: InputDecoration(labelText: 'E-mail (facultatif)', errorText: _fields['email']),
      ),
      const SizedBox(height: 8),
      TextField(
        controller: _bio,
        maxLength: 300,
        maxLines: 3,
        decoration: InputDecoration(labelText: 'Quelques mots sur vous (facultatif)', errorText: _fields['bio']),
      ),
      Align(
        alignment: Alignment.centerLeft,
        child: FilledButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Enregistrement…' : 'Enregistrer')),
      ),
    ]);
  }
}

class _PreferencesCard extends ConsumerStatefulWidget {
  const _PreferencesCard({required this.me});
  final Me me;

  @override
  ConsumerState<_PreferencesCard> createState() => _PreferencesCardState();
}

class _PreferencesCardState extends ConsumerState<_PreferencesCard> {
  late final Map<String, dynamic> _prefs = Map.of(widget.me.preferences);
  static const _languages = {
    'fr': 'Français', 'en': 'Anglais', 'dioula': 'Dioula', 'baoule': 'Baoulé',
    'bete': 'Bété', 'senoufo': 'Sénoufo', 'agni': 'Agni', 'autre': 'Autre',
  };

  Future<void> _save() async {
    try {
      final me = await ref.read(authRepositoryProvider).updateProfile({'preferences': _prefs});
      ref.read(authControllerProvider.notifier).setMe(me);
      if (mounted) _toast(context, 'Préférences enregistrées.');
    } on ApiException catch (e) {
      if (mounted) _toast(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final langs = List<String>.from((_prefs['languages'] as List?) ?? []);
    return _Section(title: 'Préférences de voyage', children: [
      for (final (key, label) in [
        ('music', 'J’aime la musique pendant le trajet'),
        ('pets', 'J’accepte les animaux'),
        ('smoking', 'Je fume (pauses cigarette)'),
      ])
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(label),
          value: _prefs[key] == true,
          onChanged: (v) => setState(() => _prefs[key] = v),
        ),
      DropdownButtonFormField<String?>(
        initialValue: _prefs['chat'] as String?,
        decoration: const InputDecoration(labelText: 'Discussion'),
        items: const [
          DropdownMenuItem(value: null, child: Text('Non précisé')),
          DropdownMenuItem(value: 'QUIET', child: Text('Plutôt calme')),
          DropdownMenuItem(value: 'SOME', child: Text('Selon l’humeur')),
          DropdownMenuItem(value: 'CHATTY', child: Text('J’aime discuter')),
        ],
        onChanged: (v) => setState(() => v == null ? _prefs.remove('chat') : _prefs['chat'] = v),
      ),
      const SizedBox(height: 8),
      const Text('Langues parlées'),
      Wrap(
        spacing: 8,
        children: [
          for (final e in _languages.entries)
            FilterChip(
              label: Text(e.value),
              selected: langs.contains(e.key),
              onSelected: (on) => setState(() {
                on ? langs.add(e.key) : langs.remove(e.key);
                _prefs['languages'] = langs;
              }),
            ),
        ],
      ),
      Align(alignment: Alignment.centerLeft, child: FilledButton(onPressed: _save, child: const Text('Enregistrer'))),
    ]);
  }
}

class _ConsentsCard extends ConsumerWidget {
  const _ConsentsCard({required this.me});
  final Me me;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    Future<void> toggle(String type, bool value) async {
      try {
        final updated = await ref.read(authRepositoryProvider).consent(type, _optionalConsentVersion, value);
        ref.read(authControllerProvider.notifier).setMe(updated);
      } on ApiException catch (e) {
        if (context.mounted) _toast(context, e.message);
      }
    }

    return _Section(title: 'Consentements', children: [
      for (final c in me.requiredConsents)
        Text(
          '${c.type == 'TERMS' ? 'Conditions d’utilisation' : 'Politique de confidentialité'} : acceptées'
          '${me.consents.where((x) => x.type == c.type).map((x) => ' le ${_dateTime.format(x.at.toLocal())}').firstOrNull ?? ''}'
          ' (version ${c.version}).',
          style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
        ),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Recevoir les offres et actualités'),
        subtitle: const Text('Les messages liés à vos trajets restent envoyés.'),
        value: me.granted('MARKETING'),
        onChanged: (v) => toggle('MARKETING', v),
      ),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Partager ma position pendant un trajet en cours'),
        subtitle: const Text('Jamais publique. Fonction prévue dans une version ultérieure.'),
        value: me.granted('LOCATION_LIVE'),
        onChanged: (v) => toggle('LOCATION_LIVE', v),
      ),
    ]);
  }
}

class _EmergencyCard extends ConsumerStatefulWidget {
  const _EmergencyCard();

  @override
  ConsumerState<_EmergencyCard> createState() => _EmergencyCardState();
}

class _EmergencyCardState extends ConsumerState<_EmergencyCard> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  Map<String, String> _fields = {};

  @override
  void initState() {
    super.initState();
    ref.read(authRepositoryProvider).emergencyContact().then((c) {
      if (c != null && mounted) {
        _name.text = c.name;
        _phone.text = c.phone;
      }
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _fields = {});
    try {
      await ref.read(authRepositoryProvider).setEmergencyContact(_name.text.trim(), _phone.text.trim());
      if (mounted) _toast(context, 'Contact d’urgence enregistré.');
    } on ApiException catch (e) {
      setState(() => _fields = e.fields);
      if (e.fields.isEmpty && mounted) _toast(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _Section(title: 'Contact d’urgence', children: [
      const Text('Privé : jamais montré aux autres membres.', style: TextStyle(color: AppColors.textMuted)),
      TextField(controller: _name, decoration: InputDecoration(labelText: 'Nom', errorText: _fields['name'])),
      TextField(
        controller: _phone,
        keyboardType: TextInputType.phone,
        decoration: InputDecoration(labelText: 'Téléphone', errorText: _fields['phone']),
      ),
      const SizedBox(height: 8),
      Align(alignment: Alignment.centerLeft, child: OutlinedButton(onPressed: _save, child: const Text('Enregistrer le contact'))),
    ]);
  }
}

class _SessionsCard extends ConsumerStatefulWidget {
  const _SessionsCard();

  @override
  ConsumerState<_SessionsCard> createState() => _SessionsCardState();
}

class _SessionsCardState extends ConsumerState<_SessionsCard> {
  late Future<List<SessionInfo>> _sessions = ref.read(authRepositoryProvider).sessions();

  void _reload() => setState(() => _sessions = ref.read(authRepositoryProvider).sessions());

  Future<void> _signOut({required bool everywhere}) async {
    await ref.read(authControllerProvider.notifier).signOut(everywhere: everywhere);
    if (mounted) context.go('/');
  }

  @override
  Widget build(BuildContext context) {
    return _Section(title: 'Appareils connectés', children: [
      FutureBuilder(
        future: _sessions,
        builder: (context, snap) {
          if (snap.hasError) return const Text('Liste indisponible pour le moment.');
          if (!snap.hasData) return const LinearProgressIndicator();
          return Column(
            children: [
              for (final s in snap.data!)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('${s.deviceLabel ?? 'Appareil'}${s.current ? ' (cet appareil)' : ''}'),
                  subtitle: Text(
                      'Dernière activité : ${s.lastUsedAt == null ? '—' : _dateTime.format(s.lastUsedAt!.toLocal())}'),
                  trailing: s.current
                      ? null
                      : TextButton(
                          onPressed: () async {
                            await ref.read(authRepositoryProvider).revokeSession(s.id);
                            _reload();
                          },
                          child: const Text('Déconnecter'),
                        ),
                ),
            ],
          );
        },
      ),
      Wrap(spacing: 8, runSpacing: 8, children: [
        OutlinedButton(onPressed: () => _signOut(everywhere: false), child: const Text('Me déconnecter')),
        OutlinedButton(onPressed: () => _signOut(everywhere: true), child: const Text('Déconnecter tous mes appareils')),
      ]),
    ]);
  }
}

class _DeleteCard extends ConsumerStatefulWidget {
  const _DeleteCard();

  @override
  ConsumerState<_DeleteCard> createState() => _DeleteCardState();
}

class _DeleteCardState extends ConsumerState<_DeleteCard> {
  OtpRequest? _otp;
  final _code = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final repo = ref.read(authRepositoryProvider);
    return _Section(title: 'Supprimer mon compte', children: [
      const Text(
        'Vos données d’identité sont effacées et vos sessions fermées. Les traces des paiements sont conservées de façon '
        'anonyme, comme la loi l’exige. Impossible tant qu’une réservation ou un trajet est en cours.',
        style: TextStyle(color: AppColors.textMuted),
      ),
      const SizedBox(height: 8),
      if (_otp == null)
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton(
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
            onPressed: _busy
                ? null
                : () => _run(() async {
                      final otp = await repo.deletionOtp();
                      setState(() => _otp = otp);
                    }),
            child: const Text('Supprimer mon compte'),
          ),
        )
      else ...[
        const Text('Saisissez le code reçu par SMS pour confirmer la suppression définitive.'),
        if (_otp!.testCode != null) Text('Mode test : code ${_otp!.testCode}'),
        const SizedBox(height: 8),
        OtpField(controller: _code, enabled: !_busy),
        const SizedBox(height: 8),
        Wrap(spacing: 8, children: [
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: _busy
                ? null
                : () => _run(() async {
                      await repo.deleteAccount(_otp!.id, _code.text);
                      ref.read(authControllerProvider.notifier).forget();
                      if (context.mounted) context.go('/');
                    }),
            child: const Text('Confirmer la suppression'),
          ),
          TextButton(onPressed: () => setState(() => _otp = null), child: const Text('Annuler')),
        ]),
      ],
      if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.danger)),
    ]);
  }
}
