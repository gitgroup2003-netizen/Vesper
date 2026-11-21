import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/api_client.dart';
import 'features/auth/login_screen.dart';
import 'features/feed/feed_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.light);
  runApp(const ProviderScope(child: VesperApp()));
}

class VesperApp extends StatelessWidget {
  const VesperApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Vesper',
        debugShowCheckedModeBanner: false,
        theme: ThemeData.dark(useMaterial3: true),
        home: const _AuthGate(),
      );
}

/// Shows the feed when a token exists, otherwise the login screen.
class _AuthGate extends StatefulWidget {
  const _AuthGate();
  @override
  State<_AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<_AuthGate> {
  late Future<bool> _hasSession = _check();

  Future<bool> _check() async => (await const TokenStore().refresh) != null;

  @override
  Widget build(BuildContext context) => FutureBuilder<bool>(
        future: _hasSession,
        builder: (_, snap) {
          if (!snap.hasData) return const Scaffold(body: Center(child: CircularProgressIndicator()));
          if (snap.data!) return const FeedScreen();
          return LoginScreen(onSignedIn: () => setState(() => _hasSession = Future.value(true)));
        },
      );
}
