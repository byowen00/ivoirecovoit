import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/appearance.dart';
import '../../core/server_address.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../account/account_screen.dart' show DeleteAccountCard;
import '../auth/auth_controller.dart';
import '../auth/models.dart';
import '../auth/otp_field.dart';
import '../trust/notifications_screen.dart' show NotificationPreferencesCard;

/// Circulation connue de l'équipe : alerte saisie dans l'administration et heures de pointe habituelles.
class TrafficInfo {
  TrafficInfo.fromJson(Map<String, dynamic> j)
    : alertNote = (j['alert'] as Map?)?['note'] as String?,
      alertUntil = (j['alert'] as Map?)?['until'] == null ? null : DateTime.parse((j['alert'] as Map)['until'] as String),
      hasAlert = j['alert'] != null,
      peakNow = j['peakNow'] as bool? ?? false,
      windows = [
        for (final w in (j['peakHours'] as List? ?? []))
          (days: [for (final d in (w as Map)['days'] as List) d as int], from: w['from'] as String, to: w['to'] as String),
      ],
      source = j['source'] as String? ?? '';
  final bool hasAlert;
  final String? alertNote;
  final DateTime? alertUntil;
  final bool peakNow;
  final List<({List<int> days, String from, String to})> windows;
  final String source;
}

final trafficProvider = FutureProvider.autoDispose<TrafficInfo>(
  (ref) async => TrafficInfo.fromJson(await ref.watch(apiClientProvider).get('/app/traffic', retries: 0)),
);

const _dayNames = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

/// « 1 2 3 4 5 » → « lun. à ven. » ; sinon la liste des jours.
String daysLabel(List<int> days) {
  final d = [...days]..sort();
  final consecutive = d.length > 2 && d.last - d.first == d.length - 1;
  if (consecutive) return '${_dayNames[d.first - 1]} à ${_dayNames[d.last - 1]}';
  return d.map((x) => _dayNames[x - 1]).join(', ');
}

/// Paramètres de l'appli : numéro, apparence, langue, compte, notifications, embouteillages.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authControllerProvider).value;
    return Scaffold(
      appBar: AppBar(title: const Text('Paramètres')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _Title('Mon compte'),
          if (me == null)
            Card(
              child: ListTile(
                leading: Icon(Icons.login, color: AppColors.brand),
                title: const Text('Se connecter'),
                subtitle: const Text('Pour gérer votre numéro, votre profil et vos notifications.'),
                onTap: () => context.push('/connexion?next=/parametres'),
              ),
            )
          else ...[
            Card(
              child: ListTile(
                key: const Key('settings-profile'),
                leading: Icon(Icons.edit_outlined, color: AppColors.brand),
                title: const Text('Modifier mon compte'),
                subtitle: const Text('Nom, photo, préférences de voyage, contact d’urgence'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/compte'),
              ),
            ),
            _PhoneCard(me: me),
          ],
          _Title('Apparence'),
          const _AppearanceCard(),
          _Title('Langue'),
          const Card(
            child: Column(
              children: [
                ListTile(
                  leading: Icon(Icons.check_circle),
                  title: Text('Français'),
                  subtitle: Text('Langue de l’application'),
                ),
                Padding(
                  padding: EdgeInsets.fromLTRB(16, 0, 16, 16),
                  child: Text(
                    'C’est la seule langue disponible pour l’instant. D’autres langues pourront être ajoutées plus tard.',
                    style: TextStyle(color: AppColors.textMuted),
                  ),
                ),
              ],
            ),
          ),
          if (me != null) ...[
            _Title('Notifications'),
            const NotificationPreferencesCard(),
          ],
          _Title('Embouteillages'),
          const _TrafficCard(),
          if (me != null) ...[
            _Title('Suppression du compte'),
            const DeleteAccountCard(),
          ],
          const ServerAddressTile(),
        ],
      ),
    );
  }
}

class _Title extends StatelessWidget {
  const _Title(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(4, 16, 4, 6),
    child: Text(text, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
  );
}

class _PhoneCard extends ConsumerStatefulWidget {
  const _PhoneCard({required this.me});
  final Me me;
  @override
  ConsumerState<_PhoneCard> createState() => _PhoneCardState();
}

class _PhoneCardState extends ConsumerState<_PhoneCard> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  bool _editing = false;
  bool _busy = false;
  OtpRequest? _otp;
  String? _error;
  String? _done;

  @override
  void dispose() {
    _phone.dispose();
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
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final repo = ref.read(authRepositoryProvider);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.phone_iphone, color: AppColors.brand),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Numéro de téléphone'),
                      Text(formatE164(widget.me.phone), style: const TextStyle(fontWeight: FontWeight.w700)),
                    ],
                  ),
                ),
                if (!_editing)
                  TextButton(
                    key: const Key('phone-change'),
                    onPressed: () => setState(() {
                      _editing = true;
                      _done = null;
                    }),
                    child: const Text('Changer'),
                  ),
              ],
            ),
            if (_done != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_done!, style: TextStyle(color: AppColors.brand))),
            if (_editing && _otp == null) ...[
              const SizedBox(height: 12),
              TextField(
                key: const Key('new-phone'),
                controller: _phone,
                keyboardType: TextInputType.phone,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
                decoration: const InputDecoration(labelText: 'Nouveau numéro', prefixText: '+225 ', hintText: '07 07 07 07 07'),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  FilledButton(
                    onPressed: _busy || _phone.text.length != 10
                        ? null
                        : () => _run(() async {
                            final otp = await repo.phoneChangeOtp(_phone.text);
                            setState(() => _otp = otp);
                          }),
                    child: const Text('Recevoir un code'),
                  ),
                  TextButton(onPressed: () => setState(() => _editing = false), child: const Text('Annuler')),
                ],
              ),
            ],
            if (_otp != null) ...[
              const SizedBox(height: 12),
              Text('Saisissez le code envoyé par SMS au +225 ${formatLocalPhone(_phone.text)}.'),
              if (_otp!.testCode != null) Text('Mode test : code ${_otp!.testCode}'),
              const SizedBox(height: 8),
              OtpField(controller: _code, enabled: !_busy),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  FilledButton(
                    key: const Key('phone-confirm'),
                    onPressed: _busy
                        ? null
                        : () => _run(() async {
                            await repo.changePhone(_otp!.id, _code.text);
                            ref.read(authControllerProvider.notifier).setMe(await repo.me());
                            setState(() {
                              _otp = null;
                              _editing = false;
                              _code.clear();
                              _phone.clear();
                              _done = 'Numéro changé. Utilisez-le désormais pour vous connecter.';
                            });
                          }),
                    child: const Text('Confirmer le nouveau numéro'),
                  ),
                  TextButton(
                    onPressed: () => setState(() {
                      _otp = null;
                      _editing = false;
                    }),
                    child: const Text('Annuler'),
                  ),
                ],
              ),
            ],
            if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.danger)),
          ],
        ),
      ),
    );
  }
}

class _AppearanceCard extends ConsumerWidget {
  const _AppearanceCard();

  static final _sizes = {0.85: 'Petit', 1.0: 'Normal', 1.15: 'Grand', 1.3: 'Très grand'};

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final look = ref.watch(appearanceProvider);
    final mine = ref.watch(personalLookProvider);
    final notifier = ref.read(personalLookProvider.notifier);
    Color hex(String? v) => Color(0xFF000000 | int.parse((v ?? '#888888').substring(1), radix: 16));
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Couleurs'),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ChoiceChip(
                  key: const Key('theme-auto'),
                  label: const Text('Comme IvoireCovoit'),
                  selected: mine.theme == null,
                  onSelected: (_) => notifier.setTheme(null),
                ),
                for (final e in look.themes.entries)
                  ChoiceChip(
                    key: Key('theme-${e.key}'),
                    avatar: CircleAvatar(backgroundColor: hex(e.value['brand'])),
                    label: Text((e.value['label'] ?? e.key).replaceAll(' (par défaut)', '')),
                    selected: mine.theme == e.key,
                    onSelected: (_) => notifier.setTheme(e.key),
                  ),
              ],
            ),
            if (look.themes.isEmpty)
              const Text('Les palettes s’afficheront dès que le serveur aura répondu.', style: TextStyle(color: AppColors.textMuted)),
            const SizedBox(height: 16),
            const Text('Taille du texte'),
            const SizedBox(height: 8),
            SegmentedButton<double>(
              showSelectedIcon: false,
              segments: [
                for (final e in _sizes.entries)
                  ButtonSegment(value: e.key, label: Text(e.value, maxLines: 1, overflow: TextOverflow.fade, softWrap: false)),
              ],
              selected: {_sizes.containsKey(mine.textScale) ? mine.textScale : 1.0},
              onSelectionChanged: (s) => notifier.setTextScale(s.first),
            ),
          ],
        ),
      ),
    );
  }
}

class _TrafficCard extends ConsumerWidget {
  const _TrafficCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final traffic = ref.watch(trafficProvider);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: traffic.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, _) => const Text('Informations sur la circulation indisponibles pour le moment.'),
          data: (t) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (t.hasAlert)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(color: AppColors.warningSoft, borderRadius: BorderRadius.circular(12)),
                  child: Text(
                    'Embouteillages signalés${t.alertNote != null ? ' : ${t.alertNote}' : ''}'
                    '${t.alertUntil != null ? ' (jusqu’à ${TimeOfDay.fromDateTime(t.alertUntil!.toLocal()).format(context)})' : ''}.',
                  ),
                )
              else
                const Padding(
                  padding: EdgeInsets.only(bottom: 8),
                  child: Text('Aucun embouteillage signalé par l’équipe en ce moment.'),
                ),
              Row(
                children: [
                  Icon(t.peakNow ? Icons.traffic : Icons.check_circle_outline, color: t.peakNow ? AppColors.danger : AppColors.brand),
                  const SizedBox(width: 8),
                  Expanded(child: Text(t.peakNow ? 'C’est l’heure de pointe : prévoyez de la marge.' : 'Hors heure de pointe.')),
                ],
              ),
              if (t.windows.isNotEmpty) ...[
                const SizedBox(height: 12),
                const Text('Heures de pointe habituelles', style: TextStyle(fontWeight: FontWeight.w700)),
                for (final w in t.windows) Text('• ${daysLabel(w.days)} : ${w.from.replaceAll(':', ' h ')} – ${w.to.replaceAll(':', ' h ')}'),
              ],
              const SizedBox(height: 12),
              Text(t.source, style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
            ],
          ),
        ),
      ),
    );
  }
}
