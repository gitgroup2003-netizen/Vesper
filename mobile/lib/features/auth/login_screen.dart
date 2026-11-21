import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../feed/feed_controller.dart';

/// Phone + OTP sign-in. Calls [onSignedIn] once tokens are stored.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key, required this.onSignedIn});
  final VoidCallback onSignedIn;

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _phone = TextEditingController(text: '+256');
  final _code = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;
  String? _error;

  String _message(DioException e) {
    final status = e.response?.statusCode;
    if (e.response == null) return 'No connection. Check your network and try again.';
    if (status == 429) return 'Too many attempts. Please wait and try again.';
    if (status == 401) return 'That code is incorrect or expired.';
    if (status == 400) return 'Enter your number in international format, e.g. +256700000000.';
    return 'Something went wrong. Please try again.';
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() { _busy = true; _error = null; });
    try {
      await action();
    } on DioException catch (e) {
      if (mounted) setState(() => _error = _message(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendCode() => _run(() async {
        await ref.read(apiClientProvider).requestOtp(_phone.text.trim());
        if (mounted) setState(() => _codeSent = true);
      });

  Future<void> _verify() => _run(() async {
        await ref.read(apiClientProvider).verifyOtp(_phone.text.trim(), _code.text.trim());
        widget.onSignedIn();
      });

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Vesper', textAlign: TextAlign.center, style: Theme.of(context).textTheme.displaySmall),
            const SizedBox(height: 32),
            TextField(
              controller: _phone,
              enabled: !_codeSent && !_busy,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Phone number', border: OutlineInputBorder()),
            ),
            if (_codeSent) ...[
              const SizedBox(height: 16),
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(labelText: '6-digit code', border: OutlineInputBorder()),
              ),
            ],
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: const TextStyle(color: Colors.redAccent))),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : (_codeSent ? _verify : _sendCode),
              child: _busy ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(_codeSent ? 'Verify' : 'Send code'),
            ),
            if (_codeSent) TextButton(onPressed: _busy ? null : () => setState(() { _codeSent = false; _code.clear(); }), child: const Text('Use a different number')),
          ]),
        ),
      ),
    );
  }
}
