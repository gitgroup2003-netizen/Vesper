import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/api_client.dart';

class UploadException implements Exception {
  UploadException(this.message);
  final String message;
  @override
  String toString() => 'UploadException: $message';
}

class _UrlExpired implements Exception {}

/// Resumable multipart uploader.
///  * Part state is persisted per video so an app kill or network drop resumes where it stopped.
///  * Each part retries with exponential backoff + jitter; expired presigned URLs trigger a fresh plan from the server.
///  * Uses a bare Dio for part PUTs (no bearer header: the URL is already signed).
class UploadManager {
  UploadManager(this._api) : _storage = Dio(BaseOptions(connectTimeout: const Duration(seconds: 15), sendTimeout: const Duration(minutes: 2)));

  final ApiClient _api;
  final Dio _storage;
  static const _maxPartRetries = 5;
  static const _maxPlanRefreshes = 3;

  Future<Directory> _dir() async {
    final d = Directory('${(await getApplicationSupportDirectory()).path}/uploads');
    return d.create(recursive: true);
  }

  Future<File> _stateFile(String videoId) async => File('${(await _dir()).path}/$videoId.json');

  /// Starts a new upload and runs it to completion. Returns the video id (status will be PROCESSING).
  Future<String> start(File file, {required int durationMs, String caption = '', void Function(double)? onProgress}) async {
    final size = await file.length();
    final res = await _api.dio.post('/videos/uploads', data: {
      'sizeBytes': size,
      'contentType': 'video/mp4',
      'durationMs': durationMs,
      'caption': caption,
    });
    final videoId = res.data['videoId'] as String;
    await _save(videoId, {'filePath': file.path, 'etags': <String, String>{}});
    await _run(videoId, file, onProgress);
    return videoId;
  }

  /// Resume a previously started upload (e.g. after app restart). Safe to call repeatedly.
  Future<void> resume(String videoId, {void Function(double)? onProgress}) async {
    final f = await _stateFile(videoId);
    if (!await f.exists()) throw UploadException('No saved upload state for $videoId');
    final saved = jsonDecode(await f.readAsString()) as Map<String, dynamic>;
    final file = File(saved['filePath'] as String);
    if (!await file.exists()) throw UploadException('Source file is gone');
    await _run(videoId, file, onProgress);
  }

  Future<List<String>> pendingUploads() async {
    final d = await _dir();
    return d.listSync().whereType<File>().where((f) => f.path.endsWith('.json')).map((f) => f.uri.pathSegments.last.replaceAll('.json', '')).toList();
  }

  Future<void> _run(String videoId, File file, void Function(double)? onProgress) async {
    for (var refresh = 0; refresh <= _maxPlanRefreshes; refresh++) {
      try {
        await _uploadAllParts(videoId, file, onProgress);
        return;
      } on _UrlExpired {
        continue; // loop re-fetches the plan with fresh URLs
      }
    }
    throw UploadException('Upload URLs kept expiring; try again');
  }

  Future<void> _uploadAllParts(String videoId, File file, void Function(double)? onProgress) async {
    final plan = (await _api.dio.get('/videos/$videoId/upload')).data as Map<String, dynamic>;
    final partSize = plan['partSize'] as int;
    final total = plan['totalParts'] as int;
    final etags = <int, String>{
      for (final p in (plan['uploaded'] as List)) (p['partNumber'] as int): p['etag'] as String,
    };
    final pending = (plan['pending'] as List).cast<Map<String, dynamic>>();
    onProgress?.call(etags.length / total);

    final raf = await file.open();
    try {
      final size = await file.length();
      for (final p in pending) {
        final n = p['partNumber'] as int;
        final start = (n - 1) * partSize;
        final len = min(partSize, size - start);
        await raf.setPosition(start);
        final bytes = await raf.read(len);
        etags[n] = await _putPart(p['url'] as String, bytes);
        await _save(videoId, {'filePath': file.path, 'etags': etags.map((k, v) => MapEntry('$k', v))});
        onProgress?.call(etags.length / total);
      }
    } finally {
      await raf.close();
    }

    await _api.dio.post('/videos/$videoId/complete', data: {
      'parts': [for (final e in etags.entries) {'partNumber': e.key, 'etag': e.value}],
    });
    final f = await _stateFile(videoId);
    if (await f.exists()) await f.delete();
    onProgress?.call(1);
  }

  Future<String> _putPart(String url, Uint8List bytes) async {
    for (var attempt = 0;; attempt++) {
      try {
        final res = await _storage.put<void>(
          url,
          data: Stream.fromIterable([bytes]),
          options: Options(headers: {Headers.contentLengthHeader: bytes.length, Headers.contentTypeHeader: 'application/octet-stream'}),
        );
        final etag = res.headers.value('etag');
        if (etag == null) throw UploadException('Storage did not return an ETag');
        return etag;
      } on DioException catch (e) {
        final code = e.response?.statusCode;
        if (code == 403) throw _UrlExpired();
        final retryable = code == null || code >= 500 || code == 408 || code == 429;
        if (!retryable || attempt >= _maxPartRetries) throw UploadException('Part upload failed (${code ?? e.type.name})');
        final backoff = Duration(milliseconds: (1000 * pow(2, attempt)).toInt() + Random().nextInt(500));
        await Future<void>.delayed(backoff);
      }
    }
  }

  Future<void> _save(String videoId, Map<String, dynamic> state) async {
    await (await _stateFile(videoId)).writeAsString(jsonEncode(state));
  }
}
