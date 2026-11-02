// SPK V24 Settings Provider

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

// Settings state
class SpkSettings {
  final ThemeMode themeMode;
  final ChunkSizePreset chunkSize;
  final bool performanceMode;
  final bool batterySaver;
  
  const SpkSettings({
    this.themeMode = ThemeMode.dark,
    this.chunkSize = ChunkSizePreset.auto,
    this.performanceMode = false,
    this.batterySaver = false,
  });
  
  SpkSettings copyWith({
    ThemeMode? themeMode,
    ChunkSizePreset? chunkSize,
    bool? performanceMode,
    bool? batterySaver,
  }) {
    return SpkSettings(
      themeMode: themeMode ?? this.themeMode,
      chunkSize: chunkSize ?? this.chunkSize,
      performanceMode: performanceMode ?? this.performanceMode,
      batterySaver: batterySaver ?? this.batterySaver,
    );
  }
}

enum ChunkSizePreset {
  auto('Auto', 0),
  small('Small (256 KB)', 256 * 1024),
  medium('Medium (1 MB)', 1024 * 1024),
  large('Large (4 MB)', 4 * 1024 * 1024),
  maximum('Maximum (16 MB)', 16 * 1024 * 1024);
  
  const ChunkSizePreset(this.label, this.bytes);
  final String label;
  final int bytes;
}

// Settings notifier
class SettingsNotifier extends StateNotifier<SpkSettings> {
  SettingsNotifier() : super(const SpkSettings()) {
    _load();
  }
  
  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    
    final themeModeIndex = prefs.getInt('themeMode') ?? 2; // Default dark
    final chunkSizeIndex = prefs.getInt('chunkSize') ?? 0;
    final performanceMode = prefs.getBool('performanceMode') ?? false;
    final batterySaver = prefs.getBool('batterySaver') ?? false;
    
    state = SpkSettings(
      themeMode: ThemeMode.values[themeModeIndex],
      chunkSize: ChunkSizePreset.values[chunkSizeIndex],
      performanceMode: performanceMode,
      batterySaver: batterySaver,
    );
  }
  
  Future<void> setThemeMode(ThemeMode mode) async {
    state = state.copyWith(themeMode: mode);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt('themeMode', mode.index);
  }
  
  Future<void> setChunkSize(ChunkSizePreset size) async {
    state = state.copyWith(chunkSize: size);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt('chunkSize', size.index);
  }
  
  Future<void> setPerformanceMode(bool enabled) async {
    state = state.copyWith(performanceMode: enabled);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('performanceMode', enabled);
  }
  
  Future<void> setBatterySaver(bool enabled) async {
    state = state.copyWith(batterySaver: enabled);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('batterySaver', enabled);
  }
}

// Provider
final settingsProvider = StateNotifierProvider<SettingsNotifier, SpkSettings>(
  (ref) => SettingsNotifier(),
);
