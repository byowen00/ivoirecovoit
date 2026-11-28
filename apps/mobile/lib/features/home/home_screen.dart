import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:intl/intl.dart';
import 'package:latlong2/latlong.dart';

import '../../core/appearance.dart';
import '../../core/config.dart';
import '../../core/location.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../../core/vehicle_marker.dart';
import '../driver/driver_home_screen.dart' show ModeSwitch;
import '../trust/notifications_screen.dart';
import '../../providers.dart';
import '../places/place_field.dart';
import '../places/places_repository.dart';
import '../auth/auth_controller.dart';
import '../trips/models.dart';
import '../trips/search_results_screen.dart';
import '../trips/trips_repository.dart';

/// Prochains trajets proposés, selon le type et la gamme choisis sur l'accueil.
final upcomingTripsProvider = FutureProvider.autoDispose.family<List<SearchResult>, (String?, String?)>(
  (ref, f) => ref.watch(tripsRepositoryProvider).upcoming(kind: f.$1, comfort: f.$2),
);

final popularRoutesProvider = FutureProvider.autoDispose<List<PopularRoute>>(
  (ref) => ref.watch(tripsRepositoryProvider).popularRoutes().catchError((_) => <PopularRoute>[]),
);

/// Écran 4 : accueil et recherche, axes populaires, accès à l'espace conducteur.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  Place? _from;
  Place? _to;
  DateTime? _date = DateTime.now();
  int _seats = 1;
  String? _error;
  int _swaps = 0; // recrée les champs après une inversion départ / arrivée

  /// « Partir maintenant » : départs des prochaines heures (utile en ville).
  bool _now = false;

  /// « Ma position » comme départ, à la place d'un lieu de la liste.
  ({double lat, double lng})? _myPos;
  bool _locating = false;

  /// Position du téléphone affichée sur la carte dès l'ouverture (jamais stockée ni envoyée).
  ({double lat, double lng})? _here;
  String? _hereError;

  /// Menu « Tous / En ville / Interurbain ».
  late TripKindChoice _kind = ref.read(appearanceProvider).tripKind;

  /// Gamme de véhicule choisie dans la rangée du haut (Toutes, Éco, Confort, Luxe).
  ComfortChoice _comfort = ComfortChoice.all;

  @override
  void initState() {
    super.initState();
    // Accueil « carte » (réglage de l'administration) : la position est demandée dès l'ouverture.
    if (ref.read(appearanceProvider).mapHome) WidgetsBinding.instance.addPostFrameCallback((_) => _locate());
  }

  /// Demande la position au démarrage, pour centrer la carte sur la personne.
  Future<void> _locate() async {
    if (!mounted) return;
    setState(() {
      _locating = true;
      _hereError = null;
    });
    try {
      final p = await currentPosition();
      if (mounted) setState(() => _here = p);
    } on LocationUnavailable catch (e) {
      if (mounted) setState(() => _hereError = e.message);
    } catch (_) {
      if (mounted) setState(() => _hereError = 'Position indisponible sur cet appareil.');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  static DateTime _day(DateTime d) => DateTime(d.year, d.month, d.day);
  bool _isDay(int offset) => !_now && _date != null && _day(_date!) == _day(DateTime.now().add(Duration(days: offset)));

  void _search() {
    final pos = _myPos;
    if ((_from == null && pos == null) || _to == null) {
      setState(() => _error = 'Choisissez le départ et l’arrivée dans la liste des suggestions.');
      return;
    }
    if (pos == null && _from!.id == _to!.id) return;
    setState(() => _error = null);
    // Heure d'Abidjan = UTC. La plage s'arrête à minuit : l'API cherche dans une seule journée.
    final now = DateTime.now().toUtc();
    final d = _now ? now : _date;
    String hhmm(DateTime t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    final end = now.add(nowWindow);
    context.push(
      resultsLocation(
        SearchQuery(
          fromId: pos == null ? _from!.id : '',
          fromLabel: pos == null ? _from!.label : 'Ma position',
          fromLat: pos?.lat,
          fromLng: pos?.lng,
          toId: _to!.id,
          toLabel: _to!.label,
          date: d == null ? null : DateTime.utc(d.year, d.month, d.day),
          timeFrom: _now ? hhmm(now) : null,
          timeTo: _now ? (end.day == now.day ? hhmm(end) : '23:59') : null,
          seats: _seats,
          kind: _kind.code,
          comfort: _comfort.code,
        ),
      ),
    );
  }

  Future<void> _useMyPosition() async {
    setState(() {
      _locating = true;
      _error = null;
    });
    try {
      final p = _here ?? await currentPosition();
      if (mounted) setState(() => _myPos = _here = p);
    } on LocationUnavailable catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  void _swap() => setState(() {
    if (_myPos != null) return; // « Ma position » ne peut servir que de départ
    final from = _from;
    _from = _to;
    _to = from;
    _swaps++;
  });

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date ?? now,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(const Duration(days: 90)),
    );
    if (picked != null) {
      setState(() {
        _now = false;
        _date = picked;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final repo = ref.watch(placesRepositoryProvider);
    final samePlace = _myPos == null && _from != null && _to != null && _from!.id == _to!.id;
    final me = ref.watch(authControllerProvider).value;
    final signedIn = me != null;
    final firstName = me?.firstName?.trim();
    final otherDate = !_now && _date != null && !_isDay(0) && !_isDay(1);
    final look = ref.watch(appearanceProvider);

    return Scaffold(
      bottomNavigationBar: const _BottomNav(),
      body: ListView(
        padding: EdgeInsets.zero,
        children: [
          // Carte avec la position du téléphone, menu déroulant en haut à gauche.
          if (!look.mapHome)
            _ClassicHeader(
              menu: _HomeMenu(signedIn: signedIn),
              actions: [
                if (signedIn) const NotificationBell(),
                _AccountButton(signedIn: signedIn, initial: firstName),
              ],
            )
          else
          _HomeMap(
            liveDrivers: look.liveDrivers,
            position: _here,
            locating: _locating,
            message: _hereError,
            onLocate: _locate,
            onUseAsDeparture: _here == null ? null : () => setState(() => _myPos = _here),
            menu: _HomeMenu(signedIn: signedIn),
            actions: [
              if (signedIn) const NotificationBell(),
              _AccountButton(signedIn: signedIn, initial: firstName),
            ],
          ),
          // Panneau de recherche, à cheval sur la carte : gammes de véhicule, puis le trajet.
          Transform.translate(
            offset: const Offset(0, -28),
            child: Padding(
              padding: EdgeInsets.zero,
              child: Container(
                padding: const EdgeInsets.fromLTRB(18, 10, 18, 18),
                decoration: const BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
                  boxShadow: [BoxShadow(color: Color(0x1411181C), blurRadius: 24, offset: Offset(0, -4))],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                      child: Container(
                        width: 40,
                        height: 4,
                        margin: const EdgeInsets.only(bottom: 12),
                        decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2)),
                      ),
                    ),
                    // Bascule vers l'accueil conducteur (demandes des passagers, trajets, gains).
                    if (signedIn) ...[
                      Material(
                        color: AppColors.night,
                        borderRadius: BorderRadius.circular(22),
                        child: const Padding(padding: EdgeInsets.all(4), child: ModeSwitch()),
                      ),
                      const SizedBox(height: 12),
                    ],
                    ComfortMenu(value: _comfort, onChanged: (c) => setState(() => _comfort = c)),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            firstName != null && firstName.isNotEmpty ? 'Où allez-vous, $firstName ?' : 'Où allez-vous ?',
                            style: const TextStyle(
                              fontFamily: AppTheme.displayFont,
                              fontWeight: FontWeight.w800,
                              fontSize: 22,
                              letterSpacing: -0.3,
                            ),
                          ),
                        ),
                        _StatusPill(signedIn: signedIn),
                      ],
                    ),
                    const SizedBox(height: 12),
                    TripKindMenu(value: _kind, onChanged: (k) => setState(() => _kind = k)),
                    const SizedBox(height: 14),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              _MarkedField(
                                mark: const RouteMark.origin(size: 12),
                                child: _myPos != null
                                    ? _MyPositionField(onClear: () => setState(() => _myPos = null))
                                    : PlaceField(
                                        key: ValueKey('from-$_swaps'),
                                        label: 'Départ',
                                        initial: _from,
                                        repository: repo,
                                        onSelected: (p) => setState(() => _from = p),
                                      ),
                              ),
                              if (_myPos == null)
                                Align(
                                  alignment: Alignment.centerLeft,
                                  child: TextButton.icon(
                                    onPressed: _locating ? null : _useMyPosition,
                                    icon: _locating
                                        ? const SizedBox(
                                            width: 16,
                                            height: 16,
                                            child: CircularProgressIndicator(strokeWidth: 2),
                                          )
                                        : const Icon(Icons.my_location, size: 18),
                                    label: Text(_locating ? 'Localisation…' : 'Partir de ma position'),
                                    style: TextButton.styleFrom(
                                      padding: const EdgeInsets.only(left: 22),
                                      textStyle: const TextStyle(
                                        fontFamily: 'Inter',
                                        fontSize: 14,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                ),
                              SizedBox(height: _myPos == null ? 0 : 10),
                              _MarkedField(
                                mark: const RouteMark.destination(size: 12),
                                child: PlaceField(
                                  key: ValueKey('to-$_swaps'),
                                  label: 'Arrivée',
                                  initial: _to,
                                  repository: repo,
                                  onSelected: (p) => setState(() => _to = p),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(left: 8, top: 36),
                          child: RoundButton(
                            icon: Icons.swap_vert,
                            tooltip: 'Inverser départ et arrivée',
                            onPressed: _myPos == null ? _swap : null,
                          ),
                        ),
                      ],
                    ),
                    if (samePlace)
                      const Padding(
                        padding: EdgeInsets.only(top: 6),
                        child: Text(
                          'Le départ et l’arrivée doivent être différents.',
                          style: TextStyle(color: AppColors.danger),
                        ),
                      ),
                    const SizedBox(height: 14),
                    ChoiceButton(
                      label: 'Partir maintenant',
                      icon: Icons.bolt,
                      selected: _now,
                      onTap: () => setState(() => _now = !_now),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: ChoiceButton(
                            label: 'Aujourd’hui',
                            selected: _isDay(0),
                            onTap: () => setState(() {
                              _now = false;
                              _date = DateTime.now();
                            }),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: ChoiceButton(
                            label: 'Demain',
                            selected: _isDay(1),
                            onTap: () => setState(() {
                              _now = false;
                              _date = DateTime.now().add(const Duration(days: 1));
                            }),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: ChoiceButton(
                            label: otherDate ? DateFormat('d MMM', 'fr').format(_date!) : 'Date',
                            icon: Icons.calendar_today_outlined,
                            selected: otherDate,
                            onTap: _pickDate,
                          ),
                        ),
                      ],
                    ),
                    if (_now)
                      const Padding(
                        padding: EdgeInsets.only(top: 8),
                        child: Text(
                          'Départs des 3 prochaines heures, réservables au plus tard 30 minutes avant.',
                          style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                        ),
                      ),
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        const Expanded(
                          child: Text('Passagers', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                        ),
                        RoundButton(
                          icon: Icons.remove,
                          tooltip: 'Un passager de moins',
                          onPressed: _seats > 1 ? () => setState(() => _seats--) : null,
                        ),
                        SizedBox(
                          width: 40,
                          child: Text(
                            '$_seats',
                            textAlign: TextAlign.center,
                            semanticsLabel: '$_seats passager${_seats > 1 ? 's' : ''}',
                            style: const TextStyle(
                              fontFamily: AppTheme.displayFont,
                              fontWeight: FontWeight.w800,
                              fontSize: 20,
                            ),
                          ),
                        ),
                        RoundButton(
                          icon: Icons.add,
                          tooltip: 'Un passager de plus',
                          onPressed: _seats < 4 ? () => setState(() => _seats++) : null,
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(_error!, style: const TextStyle(color: AppColors.danger)),
                      ),
                    FilledButton.icon(
                      onPressed: samePlace ? null : _search,
                      icon: const Icon(Icons.search),
                      label: const Text('Rechercher'),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(54),
                        textStyle: const TextStyle(fontFamily: 'Inter', fontSize: 17, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Transform.translate(
            offset: const Offset(0, -12),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (!AppConfig.isProduction)
                    Container(
                      padding: const EdgeInsets.all(10),
                      margin: const EdgeInsets.only(bottom: 16),
                      decoration: BoxDecoration(color: AppColors.warningSoft, borderRadius: BorderRadius.circular(14)),
                      child: const Text(
                        'Environnement de développement : données de démonstration, aucun paiement réel.',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 13),
                      ),
                    ),
                  const SectionTitle('Trajets proposés'),
                  const SizedBox(height: 12),
                  ref
                      .watch(upcomingTripsProvider((_kind.code, _comfort.code)))
                      .when(
                        loading: () => const LinearProgressIndicator(),
                        error: (_, _) => const Text(
                          'Impossible de charger les trajets proposés pour le moment.',
                          style: TextStyle(color: AppColors.textMuted),
                        ),
                        data: (trips) => trips.isEmpty
                            ? const Text(
                                'Aucun trajet proposé dans les 14 prochains jours pour ce choix.',
                                style: TextStyle(color: AppColors.textMuted),
                              )
                            : Column(
                                key: const Key('upcoming-trips'),
                                children: [
                                  for (final r in trips)
                                    TripResultCard(
                                      result: r,
                                      onTap: () => context.push(
                                        Uri(
                                          path: '/trajets/${r.tripId}',
                                          queryParameters: {'pickup': r.pickupStopId, 'dropoff': r.dropoffStopId, 'seats': '1'},
                                        ).toString(),
                                      ),
                                    ),
                                ],
                              ),
                      ),
                  const SizedBox(height: 16),
                  if (look.showPopularRoutes) ...[
                  const SectionTitle('Trajets fréquents'),
                  const SizedBox(height: 12),
                  ref
                      .watch(popularRoutesProvider)
                      .when(
                        loading: () => const LinearProgressIndicator(),
                        error: (_, _) => const SizedBox.shrink(),
                        data: (routes) => routes.isEmpty
                            ? const Text(
                                'Les axes les plus demandés apparaîtront ici.',
                                style: TextStyle(color: AppColors.textMuted),
                              )
                            : SizedBox(
                                height: 112,
                                child: ListView.separated(
                                  scrollDirection: Axis.horizontal,
                                  itemCount: routes.length,
                                  separatorBuilder: (_, _) => const SizedBox(width: 12),
                                  itemBuilder: (_, i) => _RouteCard(route: routes[i]),
                                ),
                              ),
                      ),
                  ],
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(color: AppColors.successSoft, borderRadius: BorderRadius.circular(18)),
                    child: const Row(
                      children: [
                        Icon(Icons.verified_user_outlined, color: Color(0xFF0B5A3A), size: 28),
                        SizedBox(width: 12),
                        Expanded(
                          child: Text.rich(
                            TextSpan(
                              children: [
                                TextSpan(
                                  text: 'Conducteurs vérifiés. ',
                                  style: TextStyle(fontWeight: FontWeight.w700),
                                ),
                                TextSpan(text: 'Pièce d’identité et permis contrôlés avant le premier trajet.'),
                              ],
                            ),
                            style: TextStyle(fontSize: 14, height: 1.4, color: Color(0xFF0B4A31)),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Material(
                    color: AppColors.night,
                    borderRadius: BorderRadius.circular(AppTheme.radiusCard),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(AppTheme.radiusCard),
                      onTap: () => context.push('/conducteur'),
                      child: Padding(
                        padding: EdgeInsets.all(18),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Vous conduisez ?',
                                    style: TextStyle(
                                      fontFamily: AppTheme.displayFont,
                                      fontWeight: FontWeight.w800,
                                      fontSize: 18,
                                      color: Colors.white,
                                    ),
                                  ),
                                  SizedBox(height: 4),
                                  Text(
                                    'Proposez vos places libres et partagez les frais de route.',
                                    style: TextStyle(color: AppColors.nightMuted, fontSize: 14),
                                  ),
                                ],
                              ),
                            ),
                            Icon(Icons.arrow_forward, color: AppColors.accent),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Durée couverte par « Partir maintenant ».
const nowWindow = Duration(hours: 3);

/// Départ fixé à la position du téléphone, à la place du champ de lieu.
class _MyPositionField extends StatelessWidget {
  const _MyPositionField({required this.onClear});
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) => Container(
    height: 54,
    padding: const EdgeInsets.only(left: 14),
    decoration: BoxDecoration(color: AppColors.brandSoft, borderRadius: BorderRadius.circular(AppTheme.radiusControl)),
    child: Row(
      children: [
        Icon(Icons.my_location, size: 18, color: AppColors.brandStrong),
        const SizedBox(width: 10),
        const Expanded(
          child: Text('Ma position', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
        ),
        IconButton(tooltip: 'Choisir un lieu à la place', icon: const Icon(Icons.close), onPressed: onClear),
      ],
    ),
  );
}

/// Champ de lieu précédé de son repère sur la frise départ → arrivée.
class _MarkedField extends StatelessWidget {
  const _MarkedField({required this.mark, required this.child});
  final Widget mark;
  final Widget child;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(padding: const EdgeInsets.only(top: 22, right: 10), child: mark),
      Expanded(child: child),
    ],
  );
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.signedIn});
  final bool signedIn;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
    decoration: BoxDecoration(
      color: signedIn ? const Color(0xFF16302A) : const Color(0xFF232C31),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: signedIn ? AppColors.online : AppColors.nightMuted, shape: BoxShape.circle),
        ),
        const SizedBox(width: 8),
        Text(
          signedIn ? 'Connecté' : 'Non connecté',
          style: TextStyle(
            color: signedIn ? const Color(0xFFB7F0CB) : AppColors.nightMuted,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    ),
  );
}

class _AccountButton extends StatelessWidget {
  const _AccountButton({required this.signedIn, this.initial});
  final bool signedIn;
  final String? initial;

  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: signedIn ? 'Mon compte (connecté)' : 'Se connecter',
    onPressed: () => context.push('/compte'),
    icon: Stack(
      clipBehavior: Clip.none,
      children: [
        CircleAvatar(
          radius: 20,
          backgroundColor: signedIn ? AppColors.accent : const Color(0xFF232C31),
          child: signedIn && initial != null && initial!.isNotEmpty
              ? Text(
                  initial!.substring(0, 1).toUpperCase(),
                  style: TextStyle(
                    fontFamily: AppTheme.displayFont,
                    fontWeight: FontWeight.w800,
                    color: AppColors.night,
                  ),
                )
              : Icon(Icons.person, size: 22, color: signedIn ? AppColors.night : Colors.white),
        ),
        if (signedIn)
          Positioned(
            right: -1,
            bottom: -1,
            child: Container(
              key: const Key('online-dot'),
              width: 13,
              height: 13,
              decoration: BoxDecoration(
                color: AppColors.online,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.night, width: 2),
              ),
            ),
          ),
      ],
    ),
  );
}

class _RouteCard extends StatelessWidget {
  const _RouteCard({required this.route});
  final PopularRoute route;

  @override
  Widget build(BuildContext context) {
    final r = route;
    return SizedBox(
      width: 168,
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => context.push(
            resultsLocation(SearchQuery(fromId: r.fromId, fromLabel: r.fromLabel, toId: r.toId, toLabel: r.toLabel)),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  r.fromLabel,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13, color: AppColors.textMuted),
                ),
                const SizedBox(height: 4),
                Text(
                  '→ ${r.toLabel}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontFamily: AppTheme.displayFont, fontWeight: FontWeight.w700, fontSize: 16),
                ),
                const Spacer(),
                Text(
                  r.upcomingTrips == 0
                      ? 'Aucun trajet prévu'
                      : '${r.upcomingTrips} trajet${r.upcomingTrips > 1 ? 's' : ''} à venir',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: r.upcomingTrips == 0 ? AppColors.textMuted : const Color(0xFF0B5A3A),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Barre de navigation du bas : chaque onglet ouvre son écran.
class _BottomNav extends StatelessWidget {
  const _BottomNav();

  @override
  Widget build(BuildContext context) => NavigationBar(
    selectedIndex: 0,
    backgroundColor: AppColors.surface,
    indicatorColor: AppColors.brandSoft,
    height: 68,
    onDestinationSelected: (i) {
      const routes = [null, '/reservations', '/conducteur/publier', '/compte'];
      if (routes[i] case final path?) context.push(path);
    },
    destinations: [
      NavigationDestination(
        icon: Icon(Icons.search, color: AppColors.brand),
        label: 'Rechercher',
      ),
      NavigationDestination(icon: Icon(Icons.confirmation_number_outlined), label: 'Réservations'),
      NavigationDestination(icon: Icon(Icons.add_circle_outline), label: 'Publier'),
      NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profil'),
    ],
  );
}

/// Haut de l'accueil : carte centrée sur la position du téléphone (Abidjan si elle est inconnue).
/// La position sert seulement à l'affichage et, si on le demande, de départ de recherche.
class _HomeMap extends ConsumerStatefulWidget {
  const _HomeMap({
    required this.liveDrivers,
    required this.position,
    required this.locating,
    required this.message,
    required this.onLocate,
    required this.onUseAsDeparture,
    required this.menu,
    required this.actions,
  });
  final bool liveDrivers;
  final ({double lat, double lng})? position;
  final bool locating;
  final String? message;
  final VoidCallback onLocate;
  final VoidCallback? onUseAsDeparture;
  final Widget menu;
  final List<Widget> actions;

  static const abidjan = LatLng(5.345, -4.024);

  @override
  ConsumerState<_HomeMap> createState() => _HomeMapState();
}

/// Conducteur en circulation (position arrondie à 500 m environ par le serveur, sans identité).
typedef LiveDriver = ({String tripId, String kind, String? toLabel, LatLng point});

List<LiveDriver> parseLiveDrivers(Map<String, dynamic> j) => [
  if (j['enabled'] != false)
    for (final d in (j['data'] as List? ?? []))
      (
        tripId: (d as Map)['tripId'] as String,
        kind: d['kind'] as String? ?? 'URBAN',
        toLabel: d['toLabel'] as String?,
        point: LatLng((d['lat'] as num).toDouble(), (d['lng'] as num).toDouble()),
      ),
];

class _HomeMapState extends ConsumerState<_HomeMap> {
  final _map = MapController();
  bool _ready = false;
  List<LiveDriver> _drivers = const [];
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    if (widget.liveDrivers) {
      _poll = Timer.periodic(const Duration(seconds: 15), (_) => _loadDrivers());
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadDrivers());
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  /// Conducteurs en route autour du centre de la carte, actualisés toutes les 15 s tant que l'accueil est ouvert.
  Future<void> _loadDrivers() async {
    final c = _ready ? _map.camera.center : (_here ?? _HomeMap.abidjan);
    try {
      final j = await ref.read(apiClientProvider).get(
        '/live/drivers',
        query: {'lat': c.latitude.toStringAsFixed(4), 'lng': c.longitude.toStringAsFixed(4)},
        retries: 0,
      );
      if (mounted) setState(() => _drivers = parseLiveDrivers(j));
    } catch (_) {
      // Hors de Côte d'Ivoire ou serveur injoignable : pas de conducteurs affichés.
    }
  }

  LatLng? get _here => widget.position == null ? null : LatLng(widget.position!.lat, widget.position!.lng);

  @override
  void didUpdateWidget(covariant _HomeMap old) {
    super.didUpdateWidget(old);
    final here = _here;
    if (_ready && here != null && old.position != widget.position) _map.move(here, 15);
  }

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    final here = _here;
    // Carte sur la moitié haute de l'écran, comme une appli de course.
    final height = (MediaQuery.sizeOf(context).height * 0.48).clamp(330.0, 520.0) + top;
    return SizedBox(
      height: height,
      child: Stack(
        children: [
          Positioned.fill(
            child: Semantics(
              label: here == null ? 'Carte d’Abidjan' : 'Carte autour de votre position',
              child: FlutterMap(
                mapController: _map,
                options: MapOptions(
                  initialCenter: here ?? _HomeMap.abidjan,
                  initialZoom: here == null ? 12 : 15,
                  onMapReady: () => _ready = true,
                  interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
                ),
                children: [
                  TileLayer(urlTemplate: AppConfig.tileUrl, userAgentPackageName: 'ci.ivoirecovoit.app'),
                  if (widget.liveDrivers && _drivers.isNotEmpty)
                    MarkerLayer(
                      markers: [
                        for (final d in _drivers)
                          Marker(
                            point: d.point,
                            width: 52,
                            height: 52,
                            child: Tooltip(
                              message: d.toLabel == null ? 'Trajet en cours' : 'En route vers ${d.toLabel}',
                              child: GestureDetector(
                                key: Key('live-driver-${d.tripId}'),
                                onTap: () => context.push('/trajets/${d.tripId}'),
                                child: VehicleMapMarker(kind: d.kind),
                              ),
                            ),
                          ),
                      ],
                    ),
                  if (here != null)
                    MarkerLayer(
                      markers: [
                        Marker(
                          point: here,
                          width: 28,
                          height: 28,
                          child: Container(
                            key: const Key('home-my-position'),
                            decoration: BoxDecoration(
                              color: const Color(0xFF1A73E8),
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.white, width: 4),
                              boxShadow: const [BoxShadow(color: Color(0x551A73E8), blurRadius: 12, spreadRadius: 6)],
                            ),
                          ),
                        ),
                      ],
                    ),
                  RichAttributionWidget(
                    alignment: AttributionAlignment.bottomLeft,
                    attributions: [TextSourceAttribution(AppConfig.tileAttribution)],
                  ),
                ],
              ),
            ),
          ),
          // Barre du haut : menu déroulant à gauche, notifications et compte à droite.
          Positioned(
            top: top + 10,
            left: 12,
            right: 12,
            child: Row(
              children: [
                widget.menu,
                const SizedBox(width: 10),
                const _Brand(),
                const Spacer(),
                Container(
                  decoration: BoxDecoration(color: AppColors.night, borderRadius: BorderRadius.circular(999)),
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  child: IconTheme(
                    data: const IconThemeData(color: Colors.white),
                    child: Row(mainAxisSize: MainAxisSize.min, children: widget.actions),
                  ),
                ),
              ],
            ),
          ),
          if (widget.liveDrivers && _drivers.isNotEmpty)
            Positioned(
              top: top + 62,
              left: 12,
              child: _MapChip(
                icon: Icons.directions_car_filled,
                text: '${_drivers.length} conducteur${_drivers.length > 1 ? 's' : ''} en route (position approximative)',
              ),
            ),
          // Bas de la carte : état de la position et raccourcis.
          Positioned(
            left: 12,
            right: 12,
            bottom: 40,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: Align(
                    alignment: Alignment.bottomLeft,
                    child: widget.message != null
                        ? _MapChip(icon: Icons.location_off_outlined, text: widget.message!)
                        : widget.onUseAsDeparture != null
                        ? ActionChip(
                            key: const Key('home-use-position'),
                            avatar: Icon(Icons.trip_origin, size: 18, color: AppColors.brand),
                            label: const Text('Partir d’ici'),
                            backgroundColor: AppColors.surface,
                            onPressed: widget.onUseAsDeparture,
                          )
                        : widget.locating
                        ? const _MapChip(icon: Icons.my_location, text: 'Recherche de votre position…')
                        : const SizedBox.shrink(),
                  ),
                ),
                const SizedBox(width: 8),
                FloatingActionButton.small(
                  heroTag: 'home-locate',
                  tooltip: 'Me localiser',
                  backgroundColor: AppColors.surface,
                  foregroundColor: AppColors.brand,
                  onPressed: widget.locating
                      ? null
                      : () {
                          if (here != null && _ready) _map.move(here, 15);
                          widget.onLocate();
                        },
                  child: widget.locating
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.my_location),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MapChip extends StatelessWidget {
  const _MapChip({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(14),
      boxShadow: const [BoxShadow(color: Color(0x2211181C), blurRadius: 8)],
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: AppColors.textMuted),
        const SizedBox(width: 6),
        Flexible(child: Text(text, style: const TextStyle(fontSize: 12))),
      ],
    ),
  );
}

/// Nom de l'appli posé sur la carte.
class _Brand extends StatelessWidget {
  const _Brand();

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: BoxDecoration(color: AppColors.night, borderRadius: BorderRadius.circular(999)),
    child: Text.rich(
      TextSpan(
        text: 'Ivoire',
        children: [TextSpan(text: 'Covoit', style: TextStyle(color: AppColors.accent))],
      ),
      style: TextStyle(fontFamily: AppTheme.displayFont, fontWeight: FontWeight.w800, fontSize: 16, color: Colors.white),
    ),
  );
}

/// Entrée du menu déroulant de l'accueil : libellé, icône et écran ouvert.
typedef HomeMenuEntry = ({String label, IconData icon, String path});

/// Entrées du menu déroulant (en haut à gauche), regroupées ici plutôt qu'éparpillées sur l'accueil.
List<HomeMenuEntry> homeMenuEntries({required bool signedIn}) => [
  (label: 'Mes réservations', icon: Icons.confirmation_number_outlined, path: '/reservations'),
  (label: 'Historique des courses', icon: Icons.history, path: '/historique'),
  (label: 'Publier un trajet', icon: Icons.add_road, path: '/conducteur/publier'),
  (label: 'Espace conducteur', icon: Icons.directions_car_filled, path: '/conducteur'),
  (label: 'Mes trajets (conducteur)', icon: Icons.airport_shuttle, path: '/conducteur/trajets'),
  if (signedIn) (label: 'Notifications', icon: Icons.notifications_none, path: '/notifications'),
  (label: 'Assistance', icon: Icons.support_agent, path: '/aide/assistance'),
  (label: 'Aide et urgence', icon: Icons.help_outline, path: '/aide'),
  (label: 'État du service', icon: Icons.monitor_heart_outlined, path: '/statut'),
  (label: signedIn ? 'Mon compte' : 'Se connecter', icon: Icons.person_outline, path: '/compte'),
  (label: 'Paramètres', icon: Icons.settings_outlined, path: '/parametres'),
];

class _HomeMenu extends StatelessWidget {
  const _HomeMenu({required this.signedIn});
  final bool signedIn;

  @override
  Widget build(BuildContext context) => Material(
    color: AppColors.night,
    shape: const CircleBorder(),
    child: PopupMenuButton<String>(
      key: const Key('home-menu'),
      tooltip: 'Menu',
      icon: const Icon(Icons.menu, color: Colors.white),
      position: PopupMenuPosition.under,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      onSelected: (path) => context.push(path),
      itemBuilder: (_) => [
        for (final e in homeMenuEntries(signedIn: signedIn))
          PopupMenuItem(
            value: e.path,
            child: Row(
              children: [
                Icon(e.icon, size: 20, color: AppColors.brand),
                const SizedBox(width: 12),
                Text(e.label),
              ],
            ),
          ),
      ],
    ),
  );
}

/// Accueil « classique » (réglage de l'administration) : en-tête sombre sans carte.
class _ClassicHeader extends StatelessWidget {
  const _ClassicHeader({required this.menu, required this.actions});
  final Widget menu;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) => Container(
    color: AppColors.night,
    padding: EdgeInsets.fromLTRB(12, MediaQuery.paddingOf(context).top + 10, 12, 52),
    child: Row(
      children: [
        menu,
        const SizedBox(width: 6),
        const _Brand(),
        const Spacer(),
        IconTheme(
          data: const IconThemeData(color: Colors.white),
          child: Row(mainAxisSize: MainAxisSize.min, children: actions),
        ),
      ],
    ),
  );
}
