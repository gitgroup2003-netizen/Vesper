import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../core/api_client.dart';
import 'player_pool.dart';
import 'telemetry.dart';
import 'video_item.dart';

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(const TokenStore()));

final dataSaverProvider = StateProvider<bool>((ref) => false);

final telemetryProvider = Provider<TelemetryBuffer>((ref) {
  final t = TelemetryBuffer(ref.watch(apiClientProvider));
  ref.onDispose(t.dispose);
  return t;
});

final playerPoolProvider = Provider<PlayerPool>((ref) {
  final pool = PlayerPool()..setDataSaver(ref.read(dataSaverProvider));
  ref.onDispose(pool.dispose);
  return pool;
});

class FeedState {
  const FeedState({this.items = const [], this.index = 0, this.loading = false, this.hasMore = true, this.error});
  final List<VideoItem> items;
  final int index;
  final bool loading;
  final bool hasMore;
  final String? error;

  FeedState copyWith({List<VideoItem>? items, int? index, bool? loading, bool? hasMore, String? error, bool clearError = false}) =>
      FeedState(
        items: items ?? this.items,
        index: index ?? this.index,
        loading: loading ?? this.loading,
        hasMore: hasMore ?? this.hasMore,
        error: clearError ? null : (error ?? this.error),
      );
}

class FeedController extends Notifier<FeedState> {
  static const _prefetchThreshold = 5; // request the next page when 5 videos remain
  late final PlayerPool _pool = ref.read(playerPoolProvider);
  late final TelemetryBuffer _telemetry = ref.read(telemetryProvider);
  final String _sessionId = const Uuid().v4();
  String? _cursor;
  String? _viewingId;
  final Map<String, int> _loops = {};

  @override
  FeedState build() {
    _pool.onLoop = (id) {
      _loops[id] = (_loops[id] ?? 0) + 1;
      _telemetry.add({'videoId': id, 'type': 'loop', 'sessionId': _sessionId});
    };
    ref.listen<bool>(dataSaverProvider, (_, on) => _pool.setDataSaver(on));
    ref.onDispose(_endView);
    Future.microtask(loadMore);
    return const FeedState();
  }

  Future<void> loadMore() async {
    if (state.loading || !state.hasMore) return;
    state = state.copyWith(loading: true, clearError: true);
    try {
      final res = await ref.read(apiClientProvider).dio.get('/feed/for-you', queryParameters: {
        if (_cursor != null) 'cursor': _cursor,
        'limit': 12,
      });
      final items = (res.data['items'] as List).map((e) => VideoItem.fromJson(e as Map<String, dynamic>)).toList();
      _cursor = res.data['nextCursor'] as String?;
      final known = state.items.map((e) => e.id).toSet();
      final merged = [...state.items, ...items.where((i) => !known.contains(i.id))];
      final firstLoad = state.items.isEmpty;
      state = state.copyWith(items: merged, loading: false, hasMore: _cursor != null);
      if (firstLoad && merged.isNotEmpty) _enter(0);
    } on DioException catch (e) {
      state = state.copyWith(loading: false, error: e.response == null ? 'No connection. Tap to retry.' : 'Something went wrong. Tap to retry.');
    }
  }

  void onPageChanged(int index) {
    _endView();
    state = state.copyWith(index: index);
    _enter(index);
    if (state.items.length - index <= _prefetchThreshold) loadMore();
  }

  void _enter(int index) {
    final item = state.items[index];
    _viewingId = item.id;
    _loops[item.id] = 0;
    _telemetry.add({'videoId': item.id, 'type': 'impression', 'sessionId': _sessionId, 'durationMs': item.durationMs});
    _pool.syncWindow(state.items, index);
  }

  /// Emits one `view_end` with total watch time (loops * duration + final position), which is what the ranker trains on.
  void _endView() {
    final id = _viewingId;
    if (id == null) return;
    _viewingId = null;
    final c = _pool.controllerFor(id);
    final duration = c?.value.duration.inMilliseconds ?? 0;
    final position = c?.value.position.inMilliseconds ?? 0;
    final loops = _loops[id] ?? 0;
    final watched = loops * duration + position;
    _telemetry.add({
      'videoId': id,
      'type': watched < 2000 ? 'skip' : 'view_end',
      'sessionId': _sessionId,
      'watchedMs': watched,
      if (duration > 0) 'durationMs': duration,
      'loops': loops,
    });
  }

  void retry() => loadMore();
}

final feedControllerProvider = NotifierProvider<FeedController, FeedState>(FeedController.new);
