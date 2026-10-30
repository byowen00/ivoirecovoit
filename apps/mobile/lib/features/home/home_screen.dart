import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/config.dart';
import '../../core/theme.dart';
import '../../core/ui.dart';
import '../trust/notifications_screen.dart';
import '../../providers.dart';
import '../places/place_field.dart';
import '../places/places_repository.dart';
import '../auth/auth_controller.dart';
import '../trips/models.dart';
import '../trips/search_results_screen.dart';
import '../trips/trips_repository.dart';

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

  static DateTime _day(DateTime d) => DateTime(d.year, d.month, d.day);
  bool _isDay(int offset) => _date != null && _day(_date!) == _day(DateTime.now().add(Duration(days: offset)));

  void _search() {
    if (_from == null || _to == null) {
      setState(() => _error = 'Choisissez le départ et l’arrivée dans la liste des suggestions.');
      return;
    }
    if (_from!.id == _to!.id) return;
    setState(() => _error = null);
    final d = _date;
    context.push(
      resultsLocation(
        SearchQuery(
          fromId: _from!.id,
          fromLabel: _from!.label,
          toId: _to!.id,
          toLabel: _to!.label,
          date: d == null ? null : DateTime.utc(d.year, d.month, d.day),
          seats: _seats,
        ),
      ),
    );
  }

  void _swap() => setState(() {
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
    if (picked != null) setState(() => _date = picked);
  }

  @override
  Widget build(BuildContext context) {
    final repo = ref.watch(placesRepositoryProvider);
    final samePlace = _from != null && _to != null && _from!.id == _to!.id;
    final me = ref.watch(authControllerProvider).value;
    final signedIn = me != null;
    final firstName = me?.firstName?.trim();
    final otherDate = _date != null && !_isDay(0) && !_isDay(1);

    return Scaffold(
      bottomNavigationBar: const _BottomNav(),
      body: ListView(
        padding: EdgeInsets.zero,
        children: [
          // En-tête sombre : logo, notifications, compte et état de connexion.
          Container(
            color: AppColors.night,
            padding: EdgeInsets.fromLTRB(20, MediaQuery.paddingOf(context).top + 12, 12, 96),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text.rich(
                        TextSpan(
                          text: 'Ivoire',
                          children: [
                            TextSpan(
                              text: 'Covoit',
                              style: TextStyle(color: AppColors.accent),
                            ),
                          ],
                        ),
                        style: TextStyle(
                          fontFamily: AppTheme.displayFont,
                          fontWeight: FontWeight.w800,
                          fontSize: 22,
                          color: Colors.white,
                        ),
                      ),
                    ),
                    IconTheme(
                      data: const IconThemeData(color: Colors.white),
                      child: Row(
                        children: [
                          if (signedIn) const NotificationBell(),
                          IconButton(
                            tooltip: 'Aide et urgence',
                            icon: const Icon(Icons.help_outline, color: Colors.white),
                            onPressed: () => context.push('/aide'),
                          ),
                          _AccountButton(signedIn: signedIn, initial: firstName),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                Text(
                  firstName != null && firstName.isNotEmpty ? 'Où allez-vous,\n$firstName ?' : 'Où allez-vous ?',
                  style: const TextStyle(
                    fontFamily: AppTheme.displayFont,
                    fontWeight: FontWeight.w800,
                    fontSize: 28,
                    height: 1.15,
                    letterSpacing: -0.5,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 14),
                _StatusPill(signedIn: signedIn),
              ],
            ),
          ),
          // Carte de recherche, à cheval sur l'en-tête.
          Transform.translate(
            offset: const Offset(0, -72),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(22),
                  boxShadow: const [BoxShadow(color: Color(0x1411181C), blurRadius: 24, offset: Offset(0, 8))],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              _MarkedField(
                                mark: const RouteMark.origin(size: 12),
                                child: PlaceField(
                                  key: ValueKey('from-$_swaps'),
                                  label: 'Départ',
                                  initial: _from,
                                  repository: repo,
                                  onSelected: (p) => setState(() => _from = p),
                                ),
                              ),
                              const SizedBox(height: 10),
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
                            onPressed: _swap,
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
                    Row(
                      children: [
                        Expanded(
                          child: ChoiceButton(
                            label: 'Aujourd’hui',
                            selected: _isDay(0),
                            onTap: () => setState(() => _date = DateTime.now()),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: ChoiceButton(
                            label: 'Demain',
                            selected: _isDay(1),
                            onTap: () => setState(() => _date = DateTime.now().add(const Duration(days: 1))),
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
            offset: const Offset(0, -48),
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
                      child: const Padding(
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
                  const SizedBox(height: 8),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.receipt_long_outlined),
                    title: const Text('Historique des paiements'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.push('/paiements'),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.monitor_heart_outlined),
                    title: const Text('État du service'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.push('/statut'),
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
                  style: const TextStyle(
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
    destinations: const [
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
