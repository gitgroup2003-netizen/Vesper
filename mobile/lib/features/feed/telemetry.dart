import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/api_client.dart';

/// Batches watch events, flushes every 10s / 50 events / on background, and survives app kills.
class TelemetryBuffer with WidgetsBindingObserver {
  TelemetryBuffer(this._api) {
    WidgetsBinding.instance.addObserver(this);
    _timer = Timer.periodic(const Duration(seconds: 10), (_) => flush());
    _restore();
  }

  final ApiClient _api;
  final List<Map<String, dynamic>> _queue = [];
  late final Timer _timer;
  bool _flushing = false;
  static const _maxQueued = 1000;

  void add(Map<String, dynamic> event) {
    _queue.add({...event, 'ts': DateTime.now().millisecondsSinceEpoch});
    if (_queue.length > _maxQueued) _queue.removeRange(0, _queue.length - _maxQueued);
    if (_queue.length >= 50) flush();
  }

  Future<void> flush() async {
    if (_flushing || _queue.isEmpty) return;
    _flushing = true;
    final batch = _queue.take(100).toList();
    try {
      await _api.dio.post('/events/batch', data: {'events': batch});
      _queue.removeRange(0, batch.length);
    } catch (_) {
      // Keep events queued; the next tick retries.
    } finally {
      _flushing = false;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.detached) {
      flush();
      _persist();
    }
  }

  Future<File> _file() async => File('${(await getApplicationSupportDirectory()).path}/telemetry.json');

  Future<void> _persist() async {
    try {
      await (await _file()).writeAsString(jsonEncode(_queue));
    } catch (_) {}
  }

  Future<void> _restore() async {
    try {
      final f = await _file();
      if (!await f.exists()) return;
      final saved = (jsonDecode(await f.readAsString()) as List).cast<Map<String, dynamic>>();
      _queue.insertAll(0, saved);
      await f.delete();
    } catch (_) {}
  }

  void dispose() {
    _timer.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _persist();
  }
}
