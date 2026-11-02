// SPK V24 About Screen - App information

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../theme/spk_theme.dart';

class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<SpkColors>()!;

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          physics: const BouncingScrollPhysics(),
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              // Header
              Row(
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
                ],
              ).animate().fadeIn(),
              
              const SizedBox(height: 32),
              
              // Logo
              Container(
                width: 100,
                height: 100,
                decoration: BoxDecoration(
                  gradient: colors.primaryGradient,
                  borderRadius: BorderRadius.circular(28),
                  boxShadow: [
                    BoxShadow(
                      color: colors.primary.withOpacity(0.4),
                      blurRadius: 30,
                      offset: const Offset(0, 15),
                    ),
                  ],
                ),
                child: const Center(
                  child: Text(
                    'S',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 48,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ).animate().fadeIn(delay: 100.ms).scale(begin: const Offset(0.8, 0.8)),
              
              const SizedBox(height: 24),
              
              // Title
              Text(
                'Singularity Pack',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ).animate().fadeIn(delay: 200.ms),
              
              const SizedBox(height: 8),
              
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                decoration: BoxDecoration(
                  gradient: colors.primaryGradient,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Text(
                  'Version 24.0.0',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
              ).animate().fadeIn(delay: 300.ms),
              
              const SizedBox(height: 32),
              
              // Description
              Text(
                'Next-generation data compression with AI-assisted optimization, neural lossless processing, and real-time adaptive streaming.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: colors.textSecondary,
                  height: 1.6,
                ),
              ).animate().fadeIn(delay: 400.ms),
              
              const SizedBox(height: 48),
              
              // Features Grid
              GridView.count(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisCount: 2,
                mainAxisSpacing: 16,
                crossAxisSpacing: 16,
                childAspectRatio: 1.2,
                children: [
                  _FeatureCard(
                    icon: Icons.compress_rounded,
                    title: 'Ultra Compression',
                    description: 'Up to 95% reduction',
                    gradient: colors.primaryGradient,
                  ),
                  _FeatureCard(
                    icon: Icons.psychology_rounded,
                    title: 'AI-Powered',
                    description: 'Neural optimization',
                    gradient: colors.accentGradient,
                  ),
                  _FeatureCard(
                    icon: Icons.bolt_rounded,
                    title: 'Real-time',
                    description: 'Streaming pipeline',
                    gradient: colors.successGradient,
                  ),
                  _FeatureCard(
                    icon: Icons.security_rounded,
                    title: 'Secure',
                    description: 'AES-256 encryption',
                    gradient: LinearGradient(
                      colors: [colors.warning, colors.error],
                    ),
                  ),
                ],
              ).animate().fadeIn(delay: 500.ms),
              
              const SizedBox(height: 48),
              
              // Tech Stack
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: colors.surfaceElevated,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: colors.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Technology',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        _TechChip(label: 'Rust', color: colors.warning),
                        _TechChip(label: 'Flutter', color: colors.primary),
                        _TechChip(label: 'SIMD', color: colors.success),
                        _TechChip(label: 'GPU Compute', color: colors.secondary),
                        _TechChip(label: 'Neural Networks', color: colors.error),
                        _TechChip(label: 'Zero-Copy', color: colors.primary),
                      ],
                    ),
                  ],
                ),
              ).animate().fadeIn(delay: 600.ms).slideY(begin: 0.1),
              
              const SizedBox(height: 48),
              
              // Credits
              Text(
                'Built with ❤️ by Palarity',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: colors.textTertiary,
                ),
              ).animate().fadeIn(delay: 700.ms),
              
              const SizedBox(height: 8),
              
              Text(
                '© 2024 Singularity Pack. All rights reserved.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: colors.textTertiary,
                ),
              ).animate().fadeIn(delay: 800.ms),
              
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }
}

class _FeatureCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String description;
  final Gradient gradient;
  
  const _FeatureCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.gradient,
  });
  
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).extension<SpkColors>()!;
    
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.surfaceElevated,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              gradient: gradient,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: Colors.white, size: 22),
          ),
          const Spacer(),
          Text(
            title,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            description,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: colors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class _TechChip extends StatelessWidget {
  final String label;
  final Color color;
  
  const _TechChip({
    required this.label,
    required this.color,
  });
  
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.w500,
          fontSize: 12,
        ),
      ),
    );
  }
}
