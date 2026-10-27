import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/theme.dart';
import '../../providers.dart';

/// Vérifie que l'application joint l'API et la base de données.
class StatusScreen extends ConsumerStatefulWidget {
  const StatusScreen({super.key});

  @override
  ConsumerState<StatusScreen> createState() => _StatusScreenState();
}

class _StatusScreenState extends ConsumerState<StatusScreen> {
  late Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _check();
  }

  Future<Map<String, dynamic>> _check() => ref.read(apiClientProvider).get('/health', retries: 1);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('État du service')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: FutureBuilder<Map<String, dynamic>>(
          future: _future,
          builder: (context, snap) {
            final Widget content;
            if (snap.connectionState != ConnectionState.done) {
              content = const Text('Vérification en cours…');
            } else if (snap.hasError) {
              final err = snap.error;
              content = Text(err is ApiException ? err.message : 'Service injoignable.',
                  style: const TextStyle(color: AppColors.danger));
            } else {
              content = const Text('API et base de données opérationnelles.',
                  style: TextStyle(color: AppColors.success));
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                content,
                const SizedBox(height: 24),
                OutlinedButton(
                  onPressed: () => setState(() => _future = _check()),
                  child: const Text('Réessayer'),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
