import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Ouvre [location] par-dessus l'accueil, pour que la flèche de retour y ramène
/// (après une connexion ou une réservation, la pile d'écrans précédente est remplacée).
void goWithHome(BuildContext context, String location) {
  final router = GoRouter.of(context);
  router.go('/');
  if (location == '/') return;
  WidgetsBinding.instance.addPostFrameCallback((_) => router.push(location));
}

/// Bouton « Accueil » quand l'écran n'a pas d'écran précédent (sinon la flèche de retour habituelle).
Widget? homeLeading(BuildContext context) => context.canPop()
    ? null
    : IconButton(tooltip: 'Accueil', icon: const Icon(Icons.home_outlined), onPressed: () => context.go('/'));
