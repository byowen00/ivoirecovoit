import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/auth/auth_controller.dart';
import '../providers.dart';
import 'config.dart';

const _serverKey = 'server_url';

/// Normalise une adresse saisie : https:// par défaut, sans barre finale ni « /api/v1 ». null si invalide.
String? normalizeServerUrl(String input) {
  var s = input.trim();
  if (s.isEmpty) return null;
  if (!s.startsWith('http://') && !s.startsWith('https://')) s = 'https://$s';
  s = s.replaceFirst(RegExp(r'/+$'), '').replaceFirst(RegExp(r'/api/v1$'), '');
  final uri = Uri.tryParse(s);
  if (uri == null || uri.host.isEmpty) return null;
  return s;
}

/// Adresse du serveur utilisée par l'appli. Hors production, elle peut être changée dans l'appli (essais via
/// Cloudflare Tunnel, dont l'adresse change à chaque lancement) ; sinon c'est celle fixée à la compilation.
class ServerUrl extends Notifier<String> {
  @override
  String build() {
    if (AppConfig.isProduction) return AppConfig.apiBaseUrl;
    try {
      return ref.read(sharedPreferencesProvider).getString(_serverKey) ?? AppConfig.apiBaseUrl;
    } catch (_) {
      return AppConfig.apiBaseUrl;
    }
  }

  /// Change de serveur : la session de l'ancien serveur est oubliée.
  Future<void> set(String? url) async {
    if (AppConfig.isProduction) return;
    final prefs = ref.read(sharedPreferencesProvider);
    if (url == null) {
      await prefs.remove(_serverKey);
    } else {
      await prefs.setString(_serverKey, url);
    }
    await ref.read(tokenStoreProvider).clear();
    state = url ?? AppConfig.apiBaseUrl;
  }
}

final serverUrlProvider = NotifierProvider<ServerUrl, String>(ServerUrl.new);

/// Ligne « Adresse du serveur (essais) », absente des versions de production.
class ServerAddressTile extends ConsumerWidget {
  const ServerAddressTile({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (AppConfig.isProduction) return const SizedBox.shrink();
    final url = ref.watch(serverUrlProvider);
    return ListTile(
      leading: const Icon(Icons.dns_outlined),
      title: const Text('Adresse du serveur (essais)'),
      subtitle: Text(url),
      onTap: () => _edit(context, ref, url),
    );
  }

  Future<void> _edit(BuildContext context, WidgetRef ref, String current) async {
    final controller = TextEditingController(text: current);
    String? error;
    final result = await showDialog<(bool, String?)>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('Adresse du serveur'),
          content: TextField(
            controller: controller,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: InputDecoration(
              hintText: 'https://exemple.trycloudflare.com',
              helperText: 'L’adresse donnée par Cloudflare sur le PC.',
              helperMaxLines: 2,
              errorText: error,
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, (true, null)), child: const Text('Par défaut')),
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Annuler')),
            FilledButton(
              onPressed: () {
                final url = normalizeServerUrl(controller.text);
                if (url == null) return setState(() => error = 'Adresse invalide.');
                Navigator.pop(ctx, (true, url));
              },
              child: const Text('Enregistrer'),
            ),
          ],
        ),
      ),
    );
    controller.dispose();
    if (result == null || !result.$1) return;
    await ref.read(serverUrlProvider.notifier).set(result.$2);
    ref.invalidate(authControllerProvider);
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Serveur : ${ref.read(serverUrlProvider)}. Reconnectez-vous.')));
    }
  }
}
