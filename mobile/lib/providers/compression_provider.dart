// SPK V24 Compression Provider - State management for operations

import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;

// Operation state
class CompressionState {
  final OperationStatus status;
  final double progress;
  final int bytesProcessed;
  final int totalBytes;
  final double speedMbps;
  final int chunksProcessed;
  final int totalChunks;
  final Duration elapsed;
  final Duration? eta;
  final String? errorMessage;
  final String? outputPath;
  
  const CompressionState({
    this.status = OperationStatus.idle,
    this.progress = 0,
    this.bytesProcessed = 0,
    this.totalBytes = 0,
    this.speedMbps = 0,
    this.chunksProcessed = 0,
    this.totalChunks = 0,
    this.elapsed = Duration.zero,
    this.eta,
    this.errorMessage,
    this.outputPath,
  });
  
  CompressionState copyWith({
    OperationStatus? status,
    double? progress,
    int? bytesProcessed,
    int? totalBytes,
    double? speedMbps,
    int? chunksProcessed,
    int? totalChunks,
    Duration? elapsed,
    Duration? eta,
    String? errorMessage,
    String? outputPath,
  }) {
    return CompressionState(
      status: status ?? this.status,
      progress: progress ?? this.progress,
      bytesProcessed: bytesProcessed ?? this.bytesProcessed,
      totalBytes: totalBytes ?? this.totalBytes,
      speedMbps: speedMbps ?? this.speedMbps,
      chunksProcessed: chunksProcessed ?? this.chunksProcessed,
      totalChunks: totalChunks ?? this.totalChunks,
      elapsed: elapsed ?? this.elapsed,
      eta: eta ?? this.eta,
      errorMessage: errorMessage ?? this.errorMessage,
      outputPath: outputPath ?? this.outputPath,
    );
  }
  
  String get speedText {
    if (speedMbps < 1) return '${(speedMbps * 1024).toStringAsFixed(0)} KB/s';
    if (speedMbps < 1024) return '${speedMbps.toStringAsFixed(1)} MB/s';
    return '${(speedMbps / 1024).toStringAsFixed(2)} GB/s';
  }
  
  String get etaText {
    if (eta == null) return '--';
    if (eta!.inSeconds < 60) return '${eta!.inSeconds}s';
    if (eta!.inMinutes < 60) return '${eta!.inMinutes}m ${eta!.inSeconds % 60}s';
    return '${eta!.inHours}h ${eta!.inMinutes % 60}m';
  }
}

enum OperationStatus {
  idle,
  preparing,
  processing,
  finalizing,
  completed,
  cancelled,
  error,
}

// Compression notifier
class CompressionNotifier extends StateNotifier<CompressionState> {
  CompressionNotifier() : super(const CompressionState());
  
  Timer? _progressTimer;
  bool _cancelled = false;
  DateTime? _startTime;
  
  // Start compression
  Future<void> compress(String filePath, String fileName, int fileSize) async {
    _cancelled = false;
    _startTime = DateTime.now();
    
    // Initialize state
    final totalChunks = (fileSize / (1024 * 1024)).ceil().clamp(1, 1000);
    state = CompressionState(
      status: OperationStatus.preparing,
      totalBytes: fileSize,
      totalChunks: totalChunks,
    );
    
    // Get output path
    final dir = await getApplicationDocumentsDirectory();
    final outputPath = p.join(dir.path, '$fileName.spk');
    
    // Simulate compression (In real app, this calls Rust FFI)
    await Future.delayed(const Duration(milliseconds: 500));
    state = state.copyWith(status: OperationStatus.processing);
    
    _progressTimer = Timer.periodic(const Duration(milliseconds: 50), (timer) {
      if (_cancelled) {
        timer.cancel();
        state = state.copyWith(status: OperationStatus.cancelled);
        return;
      }
      
      final elapsed = DateTime.now().difference(_startTime!);
      final newProgress = min(state.progress + (Random().nextDouble() * 0.02 + 0.005), 1.0);
      final newBytesProcessed = (fileSize * newProgress).toInt();
      final newChunks = (totalChunks * newProgress).toInt();
      
      // Calculate speed
      final elapsedSecs = elapsed.inMilliseconds / 1000;
      final speedMbps = elapsedSecs > 0 
          ? (newBytesProcessed / elapsedSecs) / (1024 * 1024)
          : 0.0;
      
      // Calculate ETA
      Duration? eta;
      if (speedMbps > 0 && newProgress < 1.0) {
        final remainingBytes = fileSize - newBytesProcessed;
        final remainingSecs = remainingBytes / (speedMbps * 1024 * 1024);
        eta = Duration(seconds: remainingSecs.toInt());
      }
      
      state = state.copyWith(
        progress: newProgress,
        bytesProcessed: newBytesProcessed,
        speedMbps: speedMbps,
        chunksProcessed: newChunks,
        elapsed: elapsed,
        eta: eta,
      );
      
      if (newProgress >= 1.0) {
        timer.cancel();
        _finalize(outputPath, fileSize);
      }
    });
  }
  
  // Start decompression
  Future<void> decompress(String filePath, String fileName, int fileSize) async {
    _cancelled = false;
    _startTime = DateTime.now();
    
    final totalChunks = (fileSize / (1024 * 1024)).ceil().clamp(1, 1000);
    state = CompressionState(
      status: OperationStatus.preparing,
      totalBytes: fileSize,
      totalChunks: totalChunks,
    );
    
    final dir = await getApplicationDocumentsDirectory();
    final baseName = fileName.replaceAll('.spk', '');
    final outputPath = p.join(dir.path, baseName);
    
    await Future.delayed(const Duration(milliseconds: 500));
    state = state.copyWith(status: OperationStatus.processing);
    
    _progressTimer = Timer.periodic(const Duration(milliseconds: 40), (timer) {
      if (_cancelled) {
        timer.cancel();
        state = state.copyWith(status: OperationStatus.cancelled);
        return;
      }
      
      final elapsed = DateTime.now().difference(_startTime!);
      final newProgress = min(state.progress + (Random().nextDouble() * 0.025 + 0.008), 1.0);
      final newBytesProcessed = (fileSize * newProgress).toInt();
      final newChunks = (totalChunks * newProgress).toInt();
      
      final elapsedSecs = elapsed.inMilliseconds / 1000;
      final speedMbps = elapsedSecs > 0 
          ? (newBytesProcessed / elapsedSecs) / (1024 * 1024)
          : 0.0;
      
      Duration? eta;
      if (speedMbps > 0 && newProgress < 1.0) {
        final remainingBytes = fileSize - newBytesProcessed;
        final remainingSecs = remainingBytes / (speedMbps * 1024 * 1024);
        eta = Duration(seconds: remainingSecs.toInt());
      }
      
      state = state.copyWith(
        progress: newProgress,
        bytesProcessed: newBytesProcessed,
        speedMbps: speedMbps,
        chunksProcessed: newChunks,
        elapsed: elapsed,
        eta: eta,
      );
      
      if (newProgress >= 1.0) {
        timer.cancel();
        _finalize(outputPath, (fileSize * 1.2).toInt()); // Decompressed is larger
      }
    });
  }
  
  void _finalize(String outputPath, int resultSize) async {
    state = state.copyWith(status: OperationStatus.finalizing);
    await Future.delayed(const Duration(milliseconds: 300));
    
    state = state.copyWith(
      status: OperationStatus.completed,
      progress: 1.0,
      outputPath: outputPath,
    );
  }
  
  void cancel() {
    _cancelled = true;
    _progressTimer?.cancel();
  }
  
  void reset() {
    _progressTimer?.cancel();
    _cancelled = false;
    state = const CompressionState();
  }
  
  @override
  void dispose() {
    _progressTimer?.cancel();
    super.dispose();
  }
}

// Provider
final compressionProvider = StateNotifierProvider<CompressionNotifier, CompressionState>(
  (ref) => CompressionNotifier(),
);
