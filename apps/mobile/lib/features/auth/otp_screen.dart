import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/theme.dart';
import '../../providers.dart';
import 'auth_controller.dart';
import 'models.dart';
import 'otp_field.dart';

class OtpArgs {
  OtpArgs({required this.phone, required this.request, required this.next});
  final String phone;
  final OtpRequest request;
  final String next;
}

String deviceLabel() {
  try {
    return Platform.isAndroid ? 'Application Android' : Platform.isIOS ? 'Application iOS' : 'Application';
  } catch (_) {
    return 'Application';
  }
}

/// Écran 3 : code à 6 chiffres, renvoi après 60 s, compte à rebours de validité.
class OtpScreen extends ConsumerStatefulWidget {
  const OtpScreen({super.key, required this.args, this.clock = DateTime.now});
  final OtpArgs args;
  final DateTime Function() clock;

  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  final _code = TextEditingController();
  late OtpRequest _request = widget.args.request;
  Timer? _ticker;
  String? _error;
  String? _info;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _code.dispose();
    super.dispose();
  }

  Duration get _elapsed => widget.clock().difference(_request.sentAt);
  int get _resendIn => (_request.resendAfter - _elapsed).inSeconds.clamp(0, 9999);
  int get _expiresIn => (_request.expiresIn - _elapsed).inSeconds.clamp(0, 9999);

  Future<void> _verify(String code) async {
    if (_busy || code.length != 6) return;
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      final me = await ref.read(authRepositoryProvider).verifyOtp(_request.id, code, deviceLabel());
      ref.read(authControllerProvider.notifier).setMe(me);
      if (!mounted) return;
      if (me.profileComplete) {
        context.go(widget.args.next);
      } else {
        context.go('/inscription/profil?next=${Uri.encodeComponent(widget.args.next)}');
      }
    } on ApiException catch (e) {
      _code.clear();
      final remaining = e.details['remainingAttempts'];
      setState(() {
        _busy = false;
        _error = e.code == 'OTP_INVALID' && remaining is int
            ? 'Code incorrect. Il vous reste $remaining essai${remaining > 1 ? 's' : ''}.'
            : e.message;
      });
    }
  }

  Future<void> _resend() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final otp = await ref.read(authRepositoryProvider).requestOtp(widget.args.phone);
      _code.clear();
      setState(() {
        _request = otp;
        _info = 'Un nouveau code vous a été envoyé.';
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final expiresIn = _expiresIn;
    final mm = expiresIn ~/ 60;
    final ss = (expiresIn % 60).toString().padLeft(2, '0');
    return Scaffold(
      appBar: AppBar(title: const Text('Code de vérification')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Saisissez le code', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Text('Envoyé par SMS au +225 ${formatLocalPhone(widget.args.phone)}.'),
            if (_request.testCode != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: AppColors.warningSoft, borderRadius: BorderRadius.circular(8)),
                child: Text('Mode test (développement) : aucun SMS n’est envoyé. Code : ${_request.testCode}'),
              ),
            ],
            const SizedBox(height: 16),
            OtpField(controller: _code, enabled: !_busy && expiresIn > 0, errorText: _error, onCompleted: _verify),
            const SizedBox(height: 8),
            Semantics(
              liveRegion: true,
              child: Text(
                _info ?? (expiresIn > 0 ? 'Code valable encore $mm:$ss.' : 'Ce code a expiré. Demandez-en un nouveau.'),
                style: TextStyle(color: expiresIn > 0 ? AppColors.textMuted : AppColors.danger),
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy || expiresIn == 0 ? null : () => _verify(_code.text),
              child: Text(_busy ? 'Vérification…' : 'Valider'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: _busy || _resendIn > 0 ? null : _resend,
              child: Text(_resendIn > 0 ? 'Renvoyer le code dans $_resendIn s' : 'Renvoyer le code'),
            ),
            const SizedBox(height: 12),
            const Text('Ne communiquez jamais ce code, même à une personne qui se présente comme le support.',
                style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
          ],
        ),
      ),
    );
  }
}
