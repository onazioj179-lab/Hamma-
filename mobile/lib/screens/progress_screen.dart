// SPK V24 Progress Screen - Operation progress visualization

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:percent_indicator/circular_percent_indicator.dart';

import '../theme/spk_theme.dart';
import '../providers/compression_provider.dart';

class ProgressScreen extends ConsumerWidget {
  const ProgressScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(compressionProvider);
    final colors = Theme.of(context).extension<SpkColors>()!;
    
    // Navigate to result when completed
    ref.listen<CompressionState>(compressionProvider, (prev, next) {
      if (next.status == OperationStatus.completed) {
        context.go('/result');
      }
    });

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              // Header
              Row(
                children: [
                  IconButton(
                    onPressed: () {
                      HapticFeedback.lightImpact();
                      ref.read(compressionProvider.notifier).cancel();
                      context.pop();
                    },
                    icon: Icon(
                      Icons.arrow_back_rounded,
                      color: colors.textSecondary,
                    ),
                  ),
                  const Spacer(),
                  _StatusChip(status: state.status),
                ],
              ).animate().fadeIn(),
              
              const Spacer(),
              
              // Progress Ring
              CircularPercentIndicator(
                radius: 120,
                lineWidth: 12,
                percent: state.progress.clamp(0, 1),
                animation: true,
                animateFromLastPercent: true,
                animationDuration: 300,
                circularStrokeCap: CircularStrokeCap.round,
                backgroundColor: colors.surfaceElevated,
                linearGradient: colors.primaryGradient,
                center: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '${(state.progress * 100).toStringAsFixed(0)}%',
                      style: Theme.of(context).textTheme.displaySmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: colors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _getStatusText(state.status),
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: colors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ).animate().fadeIn(delay: 200.ms).scale(begin: const Offset(0.8, 0.8)),
              
              const SizedBox(height: 48),
              
              // Stats Row
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: colors.surfaceElevated,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: colors.border),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    _StatItem(
                      label: 'Speed',
                      value: state.speedText,
                      icon: Icons.speed_rounded,
                    ),
                    _Divider(),
                    _StatItem(
                      label: 'ETA',
                      value: state.etaText,
                      icon: Icons.timer_rounded,
                    ),
                    _Divider(),
                    _StatItem(
                      label: 'Chunks',
                      value: '${state.chunksProcessed}/${state.totalChunks}',
                      icon: Icons.layers_rounded,
                    ),
                  ],
                ),
              ).animate().fadeIn(delay: 400.ms).slideY(begin: 0.1),
              
              const SizedBox(height: 24),
              
              // Progress Bar
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: colors.surfaceElevated,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: colors.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Processed',
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: colors.textSecondary,
                          ),
                        ),
                        Text(
                          _formatBytes(state.bytesProcessed),
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: colors.textPrimary,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(6),
                      child: LinearProgressIndicator(
                        value: state.progress.clamp(0, 1),
                        minHeight: 8,
                        backgroundColor: colors.surface,
                        valueColor: AlwaysStoppedAnimation(colors.primary),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Total: ${_formatBytes(state.totalBytes)}',
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: colors.textTertiary,
                          ),
                        ),
                        Text(
                          'Elapsed: ${_formatDuration(state.elapsed)}',
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: colors.textTertiary,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ).animate().fadeIn(delay: 500.ms).slideY(begin: 0.1),
              
              const Spacer(),
              
              // Cancel Button
              SizedBox(
                width: double.infinity,
                height: 56,
                child: OutlinedButton.icon(
                  onPressed: () {
                    HapticFeedback.mediumImpact();
                    ref.read(compressionProvider.notifier).cancel();
                    context.pop();
                  },
                  icon: const Icon(Icons.close_rounded),
                  label: const Text('Cancel'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: colors.error,
                    side: BorderSide(color: colors.error.withOpacity(0.3)),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                ),
              ).animate().fadeIn(delay: 600.ms),
              
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  String _getStatusText(OperationStatus status) {
    switch (status) {
      case OperationStatus.preparing:
        return 'Preparing...';
      case OperationStatus.processing:
        return 'Processing';
      case OperationStatus.finalizing:
        return 'Finalizing...';
      case OperationStatus.completed:
        return 'Complete!';
      case OperationStatus.cancelled:
        return 'Cancelled';
      case OperationStatus.error:
        return 'Error';
      default:
        return 'Ready';
    }
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }

  String _formatDuration(Duration d) {
    if (d.inSeconds < 60) return '${d.inSeconds}s';
    if (d.inMinutes < 60) return '${d.inMinutes}m ${d.inSeconds % 60}s';
    return '${d.inHours}h ${d.inMinutes % 60}m';
  }
}

class _StatusChip extends StatelessWidget {
  final OperationStatus status;
  
  const _StatusChip({required this.status});
  
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<SpkColors>()!;
    final isProcessing = status == OperationStatus.processing || 
                         status == OperationStatus.preparing ||
                         status == OperationStatus.finalizing;
    
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: isProcessing 
            ? colors.primary.withOpacity(0.15)
            : colors.surfaceElevated,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isProcessing ? colors.primary.withOpacity(0.3) : colors.border,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (isProcessing) ...[
            SizedBox(
              width: 12,
              height: 12,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                valueColor: AlwaysStoppedAnimation(colors.primary),
              ),
            ),
            const SizedBox(width: 8),
          ],
          Text(
            'Processing',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: isProcessing ? colors.primary : colors.textSecondary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  
  const _StatItem({
    required this.label,
    required this.value,
    required this.icon,
  });
  
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<SpkColors>()!;
    
    return Column(
      children: [
        Icon(icon, color: colors.textTertiary, size: 20),
        const SizedBox(height: 8),
        Text(
          value,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: colors.textTertiary,
          ),
        ),
      ],
    );
  }
}

class _Divider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<SpkColors>()!;
    
    return Container(
      width: 1,
      height: 40,
      color: colors.border,
    );
  }
}
