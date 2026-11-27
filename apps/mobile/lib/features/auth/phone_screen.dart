import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/nav.dart';
import '../../core/theme.dart';
import '../../core/server_address.dart';
import '../../providers.dart';
import 'auth_controller.dart';
import 'models.dart';
import 'otp_screen.dart';

/// Comptes de démonstration : Koffi [DEMO], conducteur vérifié avec voiture ; Aïcha [DEMO], passagère.
const demoDriverDigits = '0000000001';
const demoPassengerDigits = '0000000011';

/// Écran 2 : inscription et connexion par le seul numéro de mobile (+225 fixe).
class PhoneScreen extends ConsumerStatefulWidget {
  const PhoneScreen({super.key, this.next = '/compte'});
  final String next;

  @override
  ConsumerState<PhoneScreen> createState() => _PhoneScreenState();
}

class _PhoneScreenState extends ConsumerState<PhoneScreen> {
  final _controller = TextEditingController();
  String? _error;
  bool _sending = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// Essais : entrée directe avec un compte de démonstration (le serveur ne le permet qu'en mode test).
  Future<void> _direct(String digits) async {
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final repo = ref.read(authRepositoryProvider);
      final otp = await repo.requestOtp(digits);
      final code = otp.testCode;
      if (code == null) {
        setState(() => _error = 'Connexion directe indisponible : le serveur n’est pas en mode test.');
        return;
      }
      final me = await repo.verifyOtp(otp.id, code, deviceLabel());
      ref.read(authControllerProvider.notifier).setMe(me);
      if (!mounted) return;
      if (me.profileComplete) {
        goWithHome(context, widget.next);
      } else {
        context.go('/inscription/profil?next=${Uri.encodeComponent(widget.next)}');
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _submit() async {
    final digits = localMobileDigits(_controller.text);
    if (digits == null) {
      setState(() => _error = 'Saisissez un numéro de mobile à 10 chiffres commençant par 01, 05 ou 07.');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final otp = await ref.read(authRepositoryProvider).requestOtp(digits);
      if (!mounted) return;
      context.push('/connexion/code', extra: OtpArgs(phone: digits, request: otp, next: widget.next));
    } on ApiException catch (e) {
      setState(() => _error = e.fields['phone'] ?? e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Connexion')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Connexion ou inscription', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            const Text('Nous vous envoyons un code par SMS pour vérifier votre numéro.'),
            const SizedBox(height: 16),
            if (!AppConfig.isProduction) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: AppColors.warningSoft, borderRadius: BorderRadius.circular(12)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text('Mode essai : entrée directe avec un compte de démonstration.'),
                    const SizedBox(height: 8),
                    FilledButton(
                      key: const Key('direct-driver'),
                      onPressed: _sending ? null : () => _direct(demoDriverDigits),
                      child: const Text('Entrer comme conducteur'),
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton(
                      key: const Key('direct-passenger'),
                      onPressed: _sending ? null : () => _direct(demoPassengerDigits),
                      child: const Text('Entrer comme passager'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],
            TextField(
              key: const Key('phone-input'),
              controller: _controller,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumberNational],
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
              decoration: InputDecoration(
                labelText: 'Numéro de mobile',
                prefixText: '+225 ',
                hintText: '07 07 07 07 07',
                helperText: 'Mobile Moov (01), MTN (05) ou Orange (07).',
                errorText: _error,
                errorMaxLines: 3,
              ),
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _sending ? null : _submit,
              child: Text(_sending ? 'Envoi du code…' : 'Recevoir un code'),
            ),
            const SizedBox(height: 24),
            const ServerAddressTile(),
          ],
        ),
      ),
    );
  }
}
