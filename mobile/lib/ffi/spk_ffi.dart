// SPK V24 FFI Bridge - Connects Flutter to Rust core

import 'dart:ffi';
import 'dart:io';
import 'dart:isolate';

import 'package:ffi/ffi.dart';

// FFI Type Definitions matching spk_mobile.h
typedef SpkResultNative = Int32;
typedef SpkSessionNative = Pointer<Void>;

// Compression callback type
typedef SpkProgressCallback = Void Function(
  Int64 bytesProcessed,
  Int64 totalBytes,
  Float speed,
  Pointer<Utf8> phase,
);
typedef SpkProgressCallbackDart = void Function(
  int bytesProcessed,
  int totalBytes,
  double speed,
  Pointer<Utf8> phase,
);

// Native function signatures
typedef SpkInitNative = Int32 Function();
typedef SpkInitDart = int Function();

typedef SpkShutdownNative = Void Function();
typedef SpkShutdownDart = void Function();

typedef SpkSessionCreateNative = SpkSessionNative Function(Uint32 chunkSize);
typedef SpkSessionCreateDart = Pointer<Void> Function(int chunkSize);

typedef SpkSessionDestroyNative = Void Function(SpkSessionNative session);
typedef SpkSessionDestroyDart = void Function(Pointer<Void> session);

typedef SpkCompressFileNative = Int32 Function(
  SpkSessionNative session,
  Pointer<Utf8> inputPath,
  Pointer<Utf8> outputPath,
);
typedef SpkCompressFileDart = int Function(
  Pointer<Void> session,
  Pointer<Utf8> inputPath,
  Pointer<Utf8> outputPath,
);

typedef SpkDecompressFileNative = Int32 Function(
  SpkSessionNative session,
  Pointer<Utf8> inputPath,
  Pointer<Utf8> outputPath,
);
typedef SpkDecompressFileDart = int Function(
  Pointer<Void> session,
  Pointer<Utf8> inputPath,
  Pointer<Utf8> outputPath,
);

typedef SpkSetProgressCallbackNative = Void Function(
  SpkSessionNative session,
  Pointer<NativeFunction<SpkProgressCallback>> callback,
);
typedef SpkSetProgressCallbackDart = void Function(
  Pointer<Void> session,
  Pointer<NativeFunction<SpkProgressCallback>> callback,
);

typedef SpkGetVersionNative = Pointer<Utf8> Function();
typedef SpkGetVersionDart = Pointer<Utf8> Function();

typedef SpkGetLastErrorNative = Pointer<Utf8> Function();
typedef SpkGetLastErrorDart = Pointer<Utf8> Function();

/// SPK FFI Bridge - Native library interface
class SpkFfi {
  static SpkFfi? _instance;
  static SpkFfi get instance => _instance ??= SpkFfi._();

  DynamicLibrary? _library;
  bool _initialized = false;

  // Function pointers
  late SpkInitDart _spkInit;
  late SpkShutdownDart _spkShutdown;
  late SpkSessionCreateDart _spkSessionCreate;
  late SpkSessionDestroyDart _spkSessionDestroy;
  late SpkCompressFileDart _spkCompressFile;
  late SpkDecompressFileDart _spkDecompressFile;
  late SpkSetProgressCallbackDart _spkSetProgressCallback;
  late SpkGetVersionDart _spkGetVersion;
  late SpkGetLastErrorDart _spkGetLastError;

  SpkFfi._();

  /// Initialize the FFI bridge
  Future<bool> initialize() async {
    if (_initialized) return true;

    try {
      _library = _openLibrary();
      if (_library == null) return false;

      _bindFunctions();

      final result = _spkInit();
      _initialized = result == 0;
      return _initialized;
    } catch (e) {
      print('SPK FFI initialization error: $e');
      return false;
    }
  }

  DynamicLibrary? _openLibrary() {
    try {
      if (Platform.isAndroid) {
        return DynamicLibrary.open('libspk_core.so');
      } else if (Platform.isIOS) {
        return DynamicLibrary.process();
      } else if (Platform.isWindows) {
        return DynamicLibrary.open('spk_core.dll');
      } else if (Platform.isMacOS) {
        return DynamicLibrary.open('libspk_core.dylib');
      } else if (Platform.isLinux) {
        return DynamicLibrary.open('libspk_core.so');
      }
    } catch (e) {
      print('Failed to load SPK library: $e');
    }
    return null;
  }

  void _bindFunctions() {
    final lib = _library!;

    _spkInit = lib
        .lookup<NativeFunction<SpkInitNative>>('spk_init')
        .asFunction<SpkInitDart>();

    _spkShutdown = lib
        .lookup<NativeFunction<SpkShutdownNative>>('spk_shutdown')
        .asFunction<SpkShutdownDart>();

    _spkSessionCreate = lib
        .lookup<NativeFunction<SpkSessionCreateNative>>('spk_session_create')
        .asFunction<SpkSessionCreateDart>();

    _spkSessionDestroy = lib
        .lookup<NativeFunction<SpkSessionDestroyNative>>('spk_session_destroy')
        .asFunction<SpkSessionDestroyDart>();

    _spkCompressFile = lib
        .lookup<NativeFunction<SpkCompressFileNative>>('spk_compress_file')
        .asFunction<SpkCompressFileDart>();

    _spkDecompressFile = lib
        .lookup<NativeFunction<SpkDecompressFileNative>>('spk_decompress_file')
        .asFunction<SpkDecompressFileDart>();

    _spkSetProgressCallback = lib
        .lookup<NativeFunction<SpkSetProgressCallbackNative>>(
            'spk_set_progress_callback')
        .asFunction<SpkSetProgressCallbackDart>();

    _spkGetVersion = lib
        .lookup<NativeFunction<SpkGetVersionNative>>('spk_get_version')
        .asFunction<SpkGetVersionDart>();

    _spkGetLastError = lib
        .lookup<NativeFunction<SpkGetLastErrorNative>>('spk_get_last_error')
        .asFunction<SpkGetLastErrorDart>();
  }

  /// Shutdown the FFI bridge
  void shutdown() {
    if (_initialized) {
      _spkShutdown();
      _initialized = false;
    }
  }

  /// Get the SPK library version
  String getVersion() {
    if (!_initialized) return 'Not initialized';
    final ptr = _spkGetVersion();
    return ptr.toDartString();
  }

  /// Get the last error message
  String getLastError() {
    if (!_initialized) return 'Not initialized';
    final ptr = _spkGetLastError();
    return ptr.toDartString();
  }

  /// Create a new compression session
  SpkSession createSession({int chunkSize = 1024 * 1024}) {
    if (!_initialized) {
      throw StateError('SPK FFI not initialized');
    }
    final sessionPtr = _spkSessionCreate(chunkSize);
    return SpkSession._(sessionPtr, this);
  }
}

/// SPK Compression Session
class SpkSession {
  final Pointer<Void> _ptr;
  final SpkFfi _ffi;
  bool _destroyed = false;

  SpkSession._(this._ptr, this._ffi);

  /// Compress a file
  Future<SpkResult> compressFile(String inputPath, String outputPath) async {
    if (_destroyed) {
      throw StateError('Session has been destroyed');
    }

    return Isolate.run(() {
      final inputPtr = inputPath.toNativeUtf8();
      final outputPtr = outputPath.toNativeUtf8();

      try {
        final result = _ffi._spkCompressFile(_ptr, inputPtr, outputPtr);
        return SpkResult.fromCode(result);
      } finally {
        malloc.free(inputPtr);
        malloc.free(outputPtr);
      }
    });
  }

  /// Decompress a file
  Future<SpkResult> decompressFile(String inputPath, String outputPath) async {
    if (_destroyed) {
      throw StateError('Session has been destroyed');
    }

    return Isolate.run(() {
      final inputPtr = inputPath.toNativeUtf8();
      final outputPtr = outputPath.toNativeUtf8();

      try {
        final result = _ffi._spkDecompressFile(_ptr, inputPtr, outputPtr);
        return SpkResult.fromCode(result);
      } finally {
        malloc.free(inputPtr);
        malloc.free(outputPtr);
      }
    });
  }

  /// Destroy the session
  void destroy() {
    if (!_destroyed) {
      _ffi._spkSessionDestroy(_ptr);
      _destroyed = true;
    }
  }
}

/// SPK Operation Result
enum SpkResult {
  success,
  errorInvalidInput,
  errorIo,
  errorCompression,
  errorDecompression,
  errorMemory,
  errorCorrupted,
  errorUnsupported,
  errorUnknown;

  static SpkResult fromCode(int code) {
    switch (code) {
      case 0:
        return SpkResult.success;
      case 1:
        return SpkResult.errorInvalidInput;
      case 2:
        return SpkResult.errorIo;
      case 3:
        return SpkResult.errorCompression;
      case 4:
        return SpkResult.errorDecompression;
      case 5:
        return SpkResult.errorMemory;
      case 6:
        return SpkResult.errorCorrupted;
      case 7:
        return SpkResult.errorUnsupported;
      default:
        return SpkResult.errorUnknown;
    }
  }

  bool get isSuccess => this == SpkResult.success;

  String get message {
    switch (this) {
      case SpkResult.success:
        return 'Operation completed successfully';
      case SpkResult.errorInvalidInput:
        return 'Invalid input provided';
      case SpkResult.errorIo:
        return 'I/O error occurred';
      case SpkResult.errorCompression:
        return 'Compression failed';
      case SpkResult.errorDecompression:
        return 'Decompression failed';
      case SpkResult.errorMemory:
        return 'Memory allocation failed';
      case SpkResult.errorCorrupted:
        return 'Data is corrupted';
      case SpkResult.errorUnsupported:
        return 'Operation not supported';
      case SpkResult.errorUnknown:
        return 'Unknown error occurred';
    }
  }
}

/// Progress information from native code
class SpkProgress {
  final int bytesProcessed;
  final int totalBytes;
  final double speedMbps;
  final String phase;

  const SpkProgress({
    required this.bytesProcessed,
    required this.totalBytes,
    required this.speedMbps,
    required this.phase,
  });

  double get progress =>
      totalBytes > 0 ? bytesProcessed / totalBytes : 0;

  Duration? get eta {
    if (speedMbps <= 0 || bytesProcessed >= totalBytes) return null;
    final remaining = totalBytes - bytesProcessed;
    final seconds = remaining / (speedMbps * 1024 * 1024);
    return Duration(seconds: seconds.toInt());
  }
}
