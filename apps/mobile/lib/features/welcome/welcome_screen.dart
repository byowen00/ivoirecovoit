import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../providers.dart';

const onboardingDoneKey = 'onboarding_done';

const _slides = [
  (Icons.route_outlined, 'Voyagez ensemble', 'Trouvez une place entre les communes d’Abidjan ou vers les villes de l’intérieur.'),
  (Icons.verified_user_outlined, 'Des conducteurs vérifiés', 'Pièce d’identité, permis et véhicule contrôlés par notre équipe avant la publication de trajets.'),
  (Icons.payments_outlined, 'Payez en toute clarté', 'Le prix est affiché avant de réserver, en FCFA. Paiement Mobile Money au moment de la réservation.'),
];

/// Écran 1 : trois diapositives, bouton « Passer ». Affiché au premier lancement seulement.
class WelcomeScreen extends ConsumerStatefulWidget {
  const WelcomeScreen({super.key});

  @override
  ConsumerState<WelcomeScreen> createState() => _WelcomeScreenState();
}

class _WelcomeScreenState extends ConsumerState<WelcomeScreen> {
  final _pages = PageController();
  int _index = 0;

  Future<void> _finish() async {
    await ref.read(sharedPreferencesProvider).setBool(onboardingDoneKey, true);
    if (mounted) context.go('/');
  }

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final last = _index == _slides.length - 1;
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Align(alignment: Alignment.topRight, child: TextButton(onPressed: _finish, child: const Text('Passer'))),
            Expanded(
              child: PageView(
                controller: _pages,
                onPageChanged: (i) => setState(() => _index = i),
                children: [
                  for (final (icon, title, text) in _slides)
                    Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(icon, size: 96, color: AppColors.brand),
                          const SizedBox(height: 24),
                          Text(title,
                              textAlign: TextAlign.center,
                              style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
                          const SizedBox(height: 12),
                          Text(text, textAlign: TextAlign.center, style: theme.textTheme.bodyLarge),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            Semantics(
              label: 'Diapositive ${_index + 1} sur ${_slides.length}',
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var i = 0; i < _slides.length; i++)
                    Container(
                      width: i == _index ? 20 : 8,
                      height: 8,
                      margin: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        color: i == _index ? AppColors.brand : AppColors.border,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: last
                      ? _finish
                      : () => _pages.nextPage(duration: const Duration(milliseconds: 250), curve: Curves.easeOut),
                  child: Text(last ? 'Commencer' : 'Suivant'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
