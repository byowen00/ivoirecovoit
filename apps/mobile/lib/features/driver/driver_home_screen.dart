import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_session.dart';
import '../trips/models.dart';
import '../trust/notifications_screen.dart' show NotificationBell;
import 'driver_repository.dart';

const _modeKey = 'mode.driver';

/// Mode de l'appli choisi par la personne : passager (par défaut) ou conducteur, gardé sur le téléphone.
class DriverModeNotifier extends Notifier<bool> {
  @override
  bool build() => ref.read(sharedPreferencesProvider).getBool(_modeKey) ?? false;

  Future<void> set(bool driver) async {
    await ref.read(sharedPreferencesProvider).setBool(_modeKey, driver);
    state = driver;
  }
}

final driverModeProvider = NotifierProvider<DriverModeNotifier, bool>(DriverModeNotifier.new);

/// Demande d'un passager en attente de la réponse du conducteur.
class DriverRequest {
  DriverRequest.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      seats = (j['seats'] as num).toInt(),
      driverNetXof = (j['driverNetXof'] as num).toInt(),
      answerBefore = j['answerBefore'] == null ? null : DateTime.parse(j['answerBefore'] as String),
      passengerName = j['passengerName'] as String? ?? 'Passager',
      tripId = (j['trip'] as Map)['id'] as String,
      kind = (j['trip'] as Map)['kind'] as String?,
      departureAt = DateTime.parse((j['trip'] as Map)['departureAt'] as String),
      pickup = j['pickup'] as String,
      dropoff = j['dropoff'] as String;
  final String id;
  final int seats;
  final int driverNetXof;
  final DateTime? answerBefore;
  final String passengerName;
  final String tripId;
  final String? kind;
  final DateTime departureAt;
  final String pickup;
  final String dropoff;
}

class DriverHomeRepository {
  DriverHomeRepository(this._session);
  final AuthSession _session;

  Future<List<DriverRequest>> requests() async => [
    for (final r in (await _session.send('GET', '/bookings/requests'))['data'] as List) DriverRequest.fromJson(r as Map<String, dynamic>),
  ];
  Future<void> accept(String bookingId) => _session.send('POST', '/bookings/$bookingId/accept', body: {});
  Future<void> reject(String bookingId) => _session.send('POST', '/bookings/$bookingId/reject', body: {});
}

final driverHomeRepositoryProvider = Provider<DriverHomeRepository>((ref) => DriverHomeRepository(ref.watch(authSessionProvider)));

/// Bascule passager / conducteur, affichée en haut des deux accueils.
class ModeSwitch extends ConsumerWidget {
  const ModeSwitch({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final driver = ref.watch(driverModeProvider);
    return SegmentedButton<bool>(
      key: const Key('mode-switch'),
      showSelectedIcon: false,
      style: SegmentedButton.styleFrom(
        backgroundColor: const Color(0xFF232C31),
        foregroundColor: Colors.white,
        selectedBackgroundColor: AppColors.accent,
        selectedForegroundColor: AppColors.night,
        visualDensity: VisualDensity.compact,
      ),
      segments: const [
        ButtonSegment(value: false, icon: Icon(Icons.person_pin_circle_outlined, size: 18), label: Text('Passager')),
        ButtonSegment(value: true, icon: Icon(Icons.directions_car_filled, size: 18), label: Text('Conducteur')),
      ],
      selected: {driver},
      onSelectionChanged: (s) => ref.read(driverModeProvider.notifier).set(s.first),
    );
  }
}

/// Accueil du mode conducteur : demandes à traiter, trajet en cours, prochains départs, raccourcis.
class DriverHomeScreen extends ConsumerStatefulWidget {
  const DriverHomeScreen({super.key});
  @override
  ConsumerState<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends ConsumerState<DriverHomeScreen> {
  DriverProfile? _profile;
  List<DriverRequest> _requests = const [];
  List<MyTrip> _running = const [];
  List<MyTrip> _upcoming = const [];
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final profile = await ref.read(driverRepositoryProvider).me();
      final ok = profile?.canPublish ?? false;
      final trips = ref.read(apiTripsRepositoryProvider);
      final results = ok
          ? await Future.wait([
              ref.read(driverHomeRepositoryProvider).requests(),
              trips.mine('in_progress').then((r) => r.trips),
              trips.mine('upcoming').then((r) => r.trips),
            ])
          : null;
      if (!mounted) return;
      setState(() {
        _profile = profile;
        if (results != null) {
          _requests = results[0] as List<DriverRequest>;
          _running = results[1] as List<MyTrip>;
          _upcoming = (results[2] as List<MyTrip>).take(3).toList();
        }
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    }
  }

  Future<void> _answer(DriverRequest r, bool accept) async {
    setState(() => _busy = true);
    try {
      final repo = ref.read(driverHomeRepositoryProvider);
      accept ? await repo.accept(r.id) : await repo.reject(r.id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(accept ? 'Demande de ${r.passengerName} acceptée : le passager doit maintenant payer.' : 'Demande refusée.')),
        );
      }
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authControllerProvider).value;
    final theme = Theme.of(context);
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            Container(
              color: AppColors.night,
              padding: EdgeInsets.fromLTRB(16, MediaQuery.paddingOf(context).top + 12, 16, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Expanded(child: ModeSwitch()),
                      const SizedBox(width: 8),
                      if (me != null) const NotificationBell(),
                      IconButton(
                        tooltip: 'Mon compte',
                        onPressed: () => context.push('/compte'),
                        icon: const Icon(Icons.account_circle, color: Colors.white),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Text(
                    me?.firstName == null ? 'Mode conducteur' : 'Bonne route, ${me!.firstName}',
                    style: const TextStyle(fontFamily: AppTheme.displayFont, fontWeight: FontWeight.w800, fontSize: 24, color: Colors.white),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _requests.isEmpty ? 'Aucune demande en attente.' : '${_requests.length} demande${_requests.length > 1 ? 's' : ''} de passager à traiter.',
                    style: const TextStyle(color: AppColors.nightMuted),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: _loading
                  ? const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
                  : me == null
                  ? _Notice(
                      text: 'Connectez-vous pour utiliser le mode conducteur.',
                      action: 'Se connecter',
                      onTap: () => context.push('/connexion?next=/'),
                    )
                  : _error != null
                  ? _Notice(text: _error!, action: 'Réessayer', onTap: _load)
                  : !(_profile?.canPublish ?? false)
                  ? _Notice(
                      text: 'Pour conduire avec IvoireCovoit, faites d’abord vérifier votre permis, votre identité et votre véhicule.',
                      action: 'Compléter mon dossier',
                      onTap: () => context.push('/conducteur'),
                    )
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _Shortcuts(),
                        const SizedBox(height: 16),
                        if (_running.isNotEmpty) ...[
                          Text('Trajet en cours', style: theme.textTheme.titleMedium),
                          for (final t in _running)
                            Card(
                              color: AppColors.successSoft,
                              child: ListTile(
                                leading: const Icon(Icons.navigation, color: AppColors.success),
                                title: Text('${t.origin} → ${t.destination}'),
                                subtitle: const Text('Partagez votre position et suivez vos passagers'),
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () => context.push('/conducteur/trajets/${t.id}').then((_) => _load()),
                              ),
                            ),
                          const SizedBox(height: 12),
                        ],
                        Text('Demandes des passagers', style: theme.textTheme.titleMedium),
                        if (_requests.isEmpty)
                          const Padding(
                            padding: EdgeInsets.symmetric(vertical: 8),
                            child: Text('Rien à traiter. Les demandes de vos trajets « sur acceptation » apparaissent ici.',
                                style: TextStyle(color: AppColors.textMuted)),
                          )
                        else
                          for (final r in _requests) _RequestCard(request: r, busy: _busy, onAnswer: (ok) => _answer(r, ok)),
                        const SizedBox(height: 12),
                        Text('Mes prochains départs', style: theme.textTheme.titleMedium),
                        if (_upcoming.isEmpty)
                          const Padding(
                            padding: EdgeInsets.symmetric(vertical: 8),
                            child: Text('Aucun trajet publié à venir.', style: TextStyle(color: AppColors.textMuted)),
                          )
                        else
                          for (final t in _upcoming)
                            Card(
                              child: ListTile(
                                title: Text('${t.origin} → ${t.destination}'),
                                subtitle: Text(
                                  '${formatDay(t.departureAt)} à ${formatTime(t.departureAt)} · ${t.seatsOccupied}/${t.seatsOffered} places réservées · ${formatXof(t.priceXof)}',
                                ),
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () => context.push('/conducteur/trajets/${t.id}').then((_) => _load()),
                              ),
                            ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Shortcuts extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    Widget tile(IconData icon, String label, String path, {bool primary = false}) => Expanded(
      child: Material(
        color: primary ? AppColors.brand : AppColors.brandSoft,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => context.push(path),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 6),
            child: Column(
              children: [
                Icon(icon, color: primary ? Colors.white : AppColors.brand),
                const SizedBox(height: 6),
                Text(label, textAlign: TextAlign.center, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: primary ? Colors.white : AppColors.text)),
              ],
            ),
          ),
        ),
      ),
    );
    return Row(
      children: [
        tile(Icons.add_road, 'Publier un trajet', '/conducteur/publier', primary: true),
        const SizedBox(width: 8),
        tile(Icons.route_outlined, 'Mes trajets', '/conducteur/trajets'),
        const SizedBox(width: 8),
        tile(Icons.account_balance_wallet_outlined, 'Mes gains', '/paiements?onglet=gains'),
        const SizedBox(width: 8),
        tile(Icons.badge_outlined, 'Mon dossier', '/conducteur'),
      ],
    );
  }
}

class _RequestCard extends StatelessWidget {
  const _RequestCard({required this.request, required this.busy, required this.onAnswer});
  final DriverRequest request;
  final bool busy;
  final void Function(bool accept) onAnswer;

  @override
  Widget build(BuildContext context) {
    final r = request;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(backgroundColor: AppColors.brandSoft, child: Icon(Icons.person, color: AppColors.brand)),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(r.passengerName, style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text('${r.seats} place${r.seats > 1 ? 's' : ''} · ${r.pickup} → ${r.dropoff}', style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                ),
                Text(formatXof(r.driverNetXof), style: const TextStyle(fontWeight: FontWeight.w800)),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Départ ${formatDay(r.departureAt)} à ${formatTime(r.departureAt)}'
              '${r.answerBefore != null ? ' · répondre avant ${formatDay(r.answerBefore!)} ${formatTime(r.answerBefore!)}' : ''}',
              style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    key: Key('accept-${r.id}'),
                    onPressed: busy ? null : () => onAnswer(true),
                    child: const Text('Accepter'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(onPressed: busy ? null : () => onAnswer(false), child: const Text('Refuser')),
                ),
                IconButton(
                  tooltip: 'Voir le trajet',
                  onPressed: () => context.push('/conducteur/trajets/${r.tripId}'),
                  icon: const Icon(Icons.open_in_new),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text, required this.action, required this.onTap});
  final String text;
  final String action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(text),
          const SizedBox(height: 12),
          FilledButton(onPressed: onTap, child: Text(action)),
        ],
      ),
    ),
  );
}
