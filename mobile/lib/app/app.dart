// SPK V24 App Root

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../theme/spk_theme.dart';
import '../providers/settings_provider.dart';
import 'router.dart';

class SpkApp extends ConsumerWidget {
  const SpkApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(settingsProvider);
    final router = ref.watch(routerProvider);
    
    return MaterialApp.router(
      title: 'Singularity Pack',
      debugShowCheckedModeBanner: false,
      theme: SpkTheme.light,
      darkTheme: SpkTheme.dark,
      themeMode: settings.themeMode,
      routerConfig: router,
    );
  }
}
