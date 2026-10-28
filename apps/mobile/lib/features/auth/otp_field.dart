import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme.dart';

/// Six cases pour le code SMS. Un seul champ (invisible) reçoit la saisie : collage, saisie automatique du code
/// par Android (autofillHints oneTimeCode) et lecteurs d'écran fonctionnent comme pour un champ ordinaire.
class OtpField extends StatefulWidget {
  const OtpField({super.key, required this.controller, this.onCompleted, this.enabled = true, this.errorText});

  final TextEditingController controller;
  final ValueChanged<String>? onCompleted;
  final bool enabled;
  final String? errorText;

  @override
  State<OtpField> createState() => _OtpFieldState();
}

class _OtpFieldState extends State<OtpField> {
  final _focus = FocusNode();

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final hasError = widget.errorText != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        GestureDetector(
          onTap: () => _focus.requestFocus(),
          child: Stack(
            children: [
              ValueListenableBuilder(
                valueListenable: widget.controller,
                builder: (context, value, _) => Row(
                  children: [
                    for (var i = 0; i < 6; i++) ...[
                      if (i > 0) const SizedBox(width: 8),
                      Expanded(
                        child: Container(
                          height: 56,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            borderRadius: BorderRadius.circular(AppTheme.radiusControl),
                            border: Border.all(
                              color: hasError
                                  ? AppColors.danger
                                  : (_focus.hasFocus && i == value.text.length.clamp(0, 5))
                                      ? AppColors.brand
                                      : AppColors.border,
                              width: 1.5,
                            ),
                          ),
                          child: Text(
                            i < value.text.length ? value.text[i] : '',
                            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w600),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Positioned.fill(
                child: Opacity(
                  opacity: 0,
                  child: TextField(
                    key: const Key('otp-input'),
                    controller: widget.controller,
                    focusNode: _focus,
                    enabled: widget.enabled,
                    autofocus: true,
                    keyboardType: TextInputType.number,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                    showCursor: false,
                    decoration: const InputDecoration(semanticCounterText: '', labelText: 'Code à 6 chiffres'),
                    onChanged: (v) {
                      setState(() {});
                      if (v.length == 6) widget.onCompleted?.call(v);
                    },
                  ),
                ),
              ),
            ],
          ),
        ),
        if (hasError)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Semantics(
              liveRegion: true,
              child: Text(widget.errorText!, style: const TextStyle(color: AppColors.danger)),
            ),
          ),
      ],
    );
  }
}
