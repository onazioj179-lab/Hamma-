// SPK V24 Settings Screen - Configuration options

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../theme/spk_theme.dart';
import '../providers/settings_provider.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(settingsProvider);
    final colors = Theme.of(context).extension<SpkColors>()!;

    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
          slivers: [
            // Header
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Row(
                  children: [
                    IconButton(
                      onPressed: () {
                        HapticFeedback.lightImpact();
                        context.pop();
                      },
                      icon: Icon(
                        Icons.arrow_back_rounded,
                        color: colors.textSecondary,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Text(
                      'Settings',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ).animate().fadeIn(),
              ),
            ),
            
            // Appearance Section
            SliverToBoxAdapter(
              child: _SectionHeader(title: 'Appearance')
                  .animate().fadeIn(delay: 100.ms),
            ),
            
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: _SettingsCard(
                  children: [
                    _SettingsTile(
                      icon: Icons.dark_mode_rounded,
                      title: 'Theme',
                      subtitle: _getThemeText(settings.themeMode),
                      trailing: _ThemeSelector(
                        value: settings.themeMode,
                        onChanged: (mode) {
                          ref.read(settingsProvider.notifier).setThemeMode(mode);
                        },
                      ),
                    ),
                  ],
                ).animate().fadeIn(delay: 150.ms).slideX(begin: -0.05),
              ),
            ),
            
            // Performance Section
            SliverToBoxAdapter(
              child: _SectionHeader(title: 'Performance')
                  .animate().fadeIn(delay: 200.ms),
            ),
            
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: _SettingsCard(
                  children: [
                    _SettingsTile(
                      icon: Icons.memory_rounded,
                      title: 'Chunk Size',
                      subtitle: settings.chunkSize.label,
                      onTap: () => _showChunkSizePicker(context, ref),
                    ),
                    _Divider(),
                    _SettingsTile(
                      icon: Icons.bolt_rounded,
                      title: 'Performance Mode',
                      subtitle: 'Use maximum resources',
                      trailing: Switch.adaptive(
                        value: settings.performanceMode,
                        onChanged: (v) {
                          HapticFeedback.lightImpact();
                          ref.read(settingsProvider.notifier).setPerformanceMode(v);
                        },
                        activeColor: colors.primary,
                      ),
                    ),
                    _Divider(),
                    _SettingsTile(
                      icon: Icons.battery_saver_rounded,
                      title: 'Battery Saver',
                      subtitle: 'Reduce speed to save power',
                      trailing: Switch.adaptive(
                        value: settings.batterySaver,
                        onChanged: (v) {
                          HapticFeedback.lightImpact();
                          ref.read(settingsProvider.notifier).setBatterySaver(v);
                        },
                        activeColor: colors.primary,
                      ),
                    ),
                  ],
                ).animate().fadeIn(delay: 250.ms).slideX(begin: -0.05),
              ),
            ),
            
            // About Section
            SliverToBoxAdapter(
              child: _SectionHeader(title: 'About')
                  .animate().fadeIn(delay: 300.ms),
            ),
            
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: _SettingsCard(
                  children: [
                    _SettingsTile(
                      icon: Icons.info_outline_rounded,
                      title: 'About SPK',
                      subtitle: 'Version 24.0.0',
                      onTap: () {
                        HapticFeedback.lightImpact();
                        context.push('/about');
                      },
                    ),
                    _Divider(),
                    _SettingsTile(
                      icon: Icons.description_rounded,
                      title: 'Documentation',
                      subtitle: 'View format specification',
                      onTap: () {},
                    ),
                    _Divider(),
                    _SettingsTile(
                      icon: Icons.code_rounded,
                      title: 'GitHub',
                      subtitle: 'View source code',
                      onTap: () {},
                    ),
                  ],
                ).animate().fadeIn(delay: 350.ms).slideX(begin: -0.05),
              ),
            ),
            
            // Bottom padding
            const SliverToBoxAdapter(
              child: SizedBox(height: 100),
            ),
          ],
        ),
      ),
    );
  }

  String _getThemeText(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.light:
        return 'Light';
      case ThemeMode.dark:
        return 'Dark';
      case ThemeMode.system:
        return 'System';
    }
  }

  void _showChunkSizePicker(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).extension<SpkColors>()!;
    final settings = ref.read(settingsProvider);
    
    showModalBottomSheet(
      context: context,
      backgroundColor: colors.surfaceElevated,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: colors.border,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              Text(
                'Chunk Size',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Larger chunks are faster but use more memory',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: colors.textSecondary,
                ),
              ),
              const SizedBox(height: 24),
              ...ChunkSizePreset.values.map((preset) {
                final isSelected = settings.chunkSize == preset;
                return InkWell(
                  onTap: () {
                    HapticFeedback.lightImpact();
                    ref.read(settingsProvider.notifier).setChunkSize(preset);
                    Navigator.pop(context);
                  },
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16, 
                      vertical: 14,
                    ),
                    decoration: BoxDecoration(
                      color: isSelected 
                          ? colors.primary.withOpacity(0.1) 
                          : null,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: isSelected ? colors.primary : Colors.transparent,
                      ),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                preset.label,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodyLarge
                                    ?.copyWith(
                                      fontWeight: FontWeight.w600,
                                      color: isSelected 
                                          ? colors.primary 
                                          : null,
                                    ),
                              ),
                              Text(
                                preset.description,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodySmall
                                    ?.copyWith(color: colors.textSecondary),
                              ),
                            ],
                          ),
                        ),
                        if (isSelected)
                          Icon(Icons.check_rounded, color: colors.primary),
                      ],
                    ),
                  ),
                );
              }),
              const SizedBox(height: 24),
            ],
          ),
        );
      },
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  
  const _SectionHeader({required this.title});
  
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<SpkColors>()!;
    
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 12),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
          color: colors.textSecondary,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

class _SettingsCard extends StatelessWidget {
  final List<Widget> children;
  
  const _SettingsCard({required this.children});
  
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<SpkColors>()!;
    
    return Container(
      decoration: BoxDecoration(
        color: colors.surfaceElevated,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: colors.border),
      ),
      child: Column(children: children),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  
  const _SettingsTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.trailing,
    this.onTap,
  });
  
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<SpkColors>()!;
    
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: colors.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: colors.primary, size: 20),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: colors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            trailing ?? Icon(
              Icons.chevron_right_rounded,
              color: colors.textTertiary,
            ),
          ],
        ),
      ),
    );
  }
}

class _ThemeSelector extends StatelessWidget {
  final ThemeMode value;
  final ValueChanged<ThemeMode> onChanged;
  
  const _ThemeSelector({
    required this.value,
    required this.onChanged,
  });
  
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<SpkColors>()!;
    
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _ThemeOption(
            icon: Icons.light_mode_rounded,
            isSelected: value == ThemeMode.light,
            onTap: () {
              HapticFeedback.lightImpact();
              onChanged(ThemeMode.light);
            },
          ),
          _ThemeOption(
            icon: Icons.dark_mode_rounded,
            isSelected: value == ThemeMode.dark,
            onTap: () {
              HapticFeedback.lightImpact();
              onChanged(ThemeMode.dark);
            },
          ),
          _ThemeOption(
            icon: Icons.settings_rounded,
            isSelected: value == ThemeMode.system,
            onTap: () {
              HapticFeedback.lightImpact();
              onChanged(ThemeMode.system);
            },
          ),
        ],
      ),
    );
  }
}

class _ThemeOption extends StatelessWidget {
  final IconData icon;
  final bool isSelected;
  final VoidCallback onTap;
  
  const _ThemeOption({
    required this.icon,
    required this.isSelected,
    required this.onTap,
  });
  
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<SpkColors>()!;
    
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: isSelected ? colors.primary : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(
          icon,
          size: 18,
          color: isSelected ? Colors.white : colors.textTertiary,
        ),
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<SpkColors>()!;
    
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Divider(height: 1, color: colors.border),
    );
  }
}
