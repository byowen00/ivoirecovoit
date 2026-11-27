import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../core/ui.dart';

/// Historique : courses comme passager, trajets conduits et paiements, réunis en un seul endroit.
class HistoryScreen extends StatelessWidget {
  const HistoryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    Widget entry(IconData icon, String title, String subtitle, String path) => Card(
      child: ListTile(
        leading: VehicleAvatar(size: 40, icon: icon),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => context.push(path),
      ),
    );
    return Scaffold(
      appBar: AppBar(title: const Text('Historique')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          entry(Icons.confirmation_number_outlined, 'Mes courses', 'Trajets réservés comme passager, avec reçus et avis.',
              '/reservations?onglet=passees'),
          entry(Icons.directions_car_filled, 'Trajets conduits', 'Trajets proposés comme conducteur et passagers transportés.',
              '/conducteur/trajets?onglet=passes'),
          entry(Icons.receipt_long_outlined, 'Paiements et remboursements', 'Toutes vos commandes payées ou remboursées.', '/paiements'),
          const SizedBox(height: 8),
          const Text(
            'Les réservations à venir restent dans « Mes réservations ».',
            style: TextStyle(fontSize: 12, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }
}
