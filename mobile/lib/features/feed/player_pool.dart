import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:video_player/video_player.dart';

import 'video_item.dart';

/// Keeps a sliding window of native players alive: [behind] before the current video and [ahead] after it.
/// Everything outside the window is disposed immediately, so memory stays flat no matter how far the user scrolls.
/// Controllers outside the window are never created, and prefetch is limited to what the window covers.
class PlayerPool extends ChangeNotifier {
  PlayerPool({this.behind = 1, int ahead = 2}) : _ahead = ahead;

  final int behind;
  int _ahead;
  bool dataSaver = false;
  void Function(String videoId)? onLoop;

  final Map<String, VideoPlayerController> _controllers = {};
  final Map<String, Future<void>> _inits = {};
  final Set<String> _failed = {};
  String? _currentId;
  bool _disposed = false;

  VideoPlayerController? controllerFor(String id) => _controllers[id];
  bool hasFailed(String id) => _failed.contains(id);

  /// Data Saver shrinks the lookahead to one video so we don't spend mobile data on videos that may never be watched.
  void setDataSaver(bool on) {
    dataSaver = on;
    _ahead = on ? 1 : 2;
  }

  /// Align the pool to [current]. Order matters: current first (fast first frame), then nearest neighbours.
  void syncWindow(List<VideoItem> items, int current) {
    if (items.isEmpty) return;
    _currentId = items[current].id;

    final wanted = <int>[current, for (var i = 1; i <= _ahead; i++) current + i, for (var i = 1; i <= behind; i++) current - i]
        .where((i) => i >= 0 && i < items.length)
        .toList();
    final keep = wanted.map((i) => items[i].id).toSet();

    for (final id in _controllers.keys.where((id) => !keep.contains(id)).toList()) {
      _controllers.remove(id)?.dispose();
      _inits.remove(id);
    }
    for (final i in wanted) {
      unawaited(_ensure(items[i]));
    }
    for (final e in _controllers.entries) {
      if (e.key != _currentId && e.value.value.isPlaying) e.value.pause();
    }
    _playIfReady(_currentId!);
    _notify();
  }

  Future<void> _ensure(VideoItem item) {
    return _inits.putIfAbsent(item.id, () async {
      final c = VideoPlayerController.networkUrl(
        Uri.parse(item.playbackUrl(dataSaver: dataSaver)),
        videoPlayerOptions: VideoPlayerOptions(mixWithOthers: false),
      );
      _controllers[item.id] = c;
      _watchLoops(item.id, c);
      try {
        await c.initialize();
        await c.setLooping(true);
        _failed.remove(item.id);
        if (_currentId == item.id) _playIfReady(item.id);
      } catch (_) {
        // Drop the broken controller so a later syncWindow can retry cleanly.
        _failed.add(item.id);
        _controllers.remove(item.id)?.dispose();
        _inits.remove(item.id);
      }
      _notify();
    });
  }

  void _watchLoops(String id, VideoPlayerController c) {
    var last = Duration.zero;
    c.addListener(() {
      final v = c.value;
      if (!v.isInitialized || v.duration == Duration.zero) return;
      final pos = v.position;
      // A loop is a wrap from near the end back to near the start.
      if (last > v.duration * 0.8 && pos < v.duration * 0.2 && last > pos) onLoop?.call(id);
      last = pos;
    });
  }

  void _playIfReady(String id) {
    final c = _controllers[id];
    if (c != null && c.value.isInitialized && !c.value.isPlaying) c.play();
  }

  void togglePlayback(String id) {
    final c = _controllers[id];
    if (c == null || !c.value.isInitialized) return;
    c.value.isPlaying ? c.pause() : c.play();
    _notify();
  }

  void pauseAll() {
    for (final c in _controllers.values) {
      if (c.value.isPlaying) c.pause();
    }
  }

  void resumeCurrent() {
    final id = _currentId;
    if (id != null) _playIfReady(id);
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    for (final c in _controllers.values) {
      c.dispose();
    }
    _controllers.clear();
    _inits.clear();
    super.dispose();
  }
}
