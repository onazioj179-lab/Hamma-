// SPK V24 Home Screen - Premium minimal interface

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../theme/spk_theme.dart';
import '../providers/settings_provider.dart';
import '../providers/compression_provider.dart';
import '../widgets/action_card.dart';
import '../widgets/stats_card.dart';
import '../widgets/recent_archive_card.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  // Mock recent archives - In real app, persisted
  final List<RecentArchive> _recentArchives = [
    RecentArchive(
      name: 'photos_2024.spk',
      originalSize: 1024 * 1024 * 256,
      compressedSize: 1024 * 1024 * 89,
      date: DateTime.now().subtract(const Duration(hours: 2)),
    ),
    RecentArchive(
      name: 'project_backup.spk',
      originalSize: 1024 * 1024 * 512,
      compressedSize: 1024 * 1024 * 178,
      date: DateTime.now().subtract(const Duration(days: 1)),
    ),
    RecentArchive(
      name: 'documents.spk',
      originalSize: 1024 * 1024 * 64,
      compressedSize: 1024 * 1024 * 18,
      date: DateTime.now().subtract(const Duration(days: 3)),
    ),
  ];

  Future<void> _pickFileForCompression() async {
    HapticFeedback.lightImpact();
    
    final result = await FilePicker.platform.pickFiles(
      allowMultiple: false,
      withData: false,
    );
    
    if (result != null && result.files.isNotEmpty) {
      final file = result.files.first;
      final compression = ref.read(compressionProvider.notifier);
      compression.compress(
        file.path ?? '',
        file.name,
        file.size,
      );
      if (mounted) context.push('/progress');
    }
  }

  Future<void> _pickFileForDecompression() async {
    HapticFeedback.lightImpact();
    
    final result = await FilePicker.platform.pickFiles(
      allowMultiple: false,
      type: FileType.custom,
      allowedExtensions: ['spk'],
    );
    
    if (result != null && result.files.isNotEmpty) {
      final file = result.files.first;
      final compression = ref.read(compressionProvider.notifier);
      compression.decompress(
        file.path ?? '',
        file.name,
        file.size,
      );
      if (mounted) context.push('/progress');
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<SpkColors>()!;
    
    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
          slivers: [
            // Header
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    // Logo & Title
                    Row(
                      children: [
                        Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            gradient: colors.primaryGradient,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Center(
                            child: Text(
                              'S',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 20,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Singularity Pack',
                              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            Text(
                              'V24 Ultra',
                              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: colors.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ).animate().fadeIn(duration: 400.ms).slideX(begin: -0.1),
                    
                    // Settings button
                    IconButton(
                      onPressed: () {
                        HapticFeedback.lightImpact();
                        context.push('/settings');
                      },
                      icon: Icon(
                        Icons.more_vert_rounded,
                        color: colors.textSecondary,
                      ),
                    ).animate().fadeIn(delay: 200.ms),
                  ],
                ),
              ),
            ),
            
            // Stats Card
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 32, 24, 0),
                child: StatsCard(
                  totalArchives: _recentArchives.length,
                  totalSaved: _recentArchives.fold<int>(
                    0, 
                    (sum, a) => sum + (a.originalSize - a.compressedSize),
                  ),
                  avgRatio: _calculateAvgRatio(),
                ).animate().fadeIn(delay: 100.ms).slideY(begin: 0.05),
              ),
            ),
            
            // Action Cards
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
                child: Row(
                  children: [
                    Expanded(
                      child: ActionCard(
                        title: 'Compress',
                        subtitle: 'Pack files',
                        icon: Icons.compress_rounded,
                        gradient: colors.primaryGradient,
                        onTap: _pickFileForCompression,
                      ).animate().fadeIn(delay: 200.ms).slideX(begin: -0.1),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: ActionCard(
                        title: 'Decompress',
                        subtitle: 'Unpack SPK',
                        icon: Icons.expand_rounded,
                        gradient: colors.accentGradient,
                        onTap: _pickFileForDecompression,
                      ).animate().fadeIn(delay: 300.ms).slideX(begin: 0.1),
                    ),
                  ],
                ),
              ),
            ),
            
            // Recent Archives Header
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 32, 24, 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Recent Archives',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    TextButton(
                      onPressed: () {},
                      child: Text(
                        'See All',
                        style: TextStyle(
                          color: colors.primary,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ],
                ).animate().fadeIn(delay: 400.ms),
              ),
            ),
            
            // Recent Archives List
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              sliver: SliverList(
                delegate: SliverChildBuilderDelegate(
                  (context, index) {
                    if (index >= _recentArchives.length) return null;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: RecentArchiveCard(
                        archive: _recentArchives[index],
                      ).animate()
                        .fadeIn(delay: (500 + index * 100).ms)
                        .slideY(begin: 0.1),
                    );
                  },
                  childCount: _recentArchives.length,
                ),
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

  double _calculateAvgRatio() {
    if (_recentArchives.isEmpty) return 0;
    final totalRatio = _recentArchives.fold<double>(
      0,
      (sum, a) => sum + (a.compressedSize / a.originalSize),
    );
    return 1 - (totalRatio / _recentArchives.length);
  }
}

// Model class for recent archives
class RecentArchive {
  final String name;
  final int originalSize;
  final int compressedSize;
  final DateTime date;
  
  const RecentArchive({
    required this.name,
    required this.originalSize,
    required this.compressedSize,
    required this.date,
  });
  
  double get ratio => 1 - (compressedSize / originalSize);
  
  String get sizeText {
    final mb = compressedSize / (1024 * 1024);
    if (mb < 1) return '${(compressedSize / 1024).toStringAsFixed(0)} KB';
    if (mb < 1024) return '${mb.toStringAsFixed(1)} MB';
    return '${(mb / 1024).toStringAsFixed(2)} GB';
  }
  
  String get dateText {
    final now = DateTime.now();
    final diff = now.difference(date);
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${date.day}/${date.month}/${date.year}';
  }
}
