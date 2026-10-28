import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../providers.dart';
import 'models.dart';
import 'otp_screen.dart';

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
          ],
        ),
      ),
    );
  }
}
