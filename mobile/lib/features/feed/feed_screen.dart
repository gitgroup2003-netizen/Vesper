import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:video_player/video_player.dart';

import 'feed_controller.dart';
import 'video_item.dart';

class FeedScreen extends ConsumerStatefulWidget {
  const FeedScreen({super.key});
  @override
  ConsumerState<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends ConsumerState<FeedScreen> with WidgetsBindingObserver {
  final _page = PageController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    final pool = ref.read(playerPoolProvider);
    if (s == AppLifecycleState.resumed) {
      pool.resumeCurrent();
    } else {
      pool.pauseAll();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _page.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(feedControllerProvider);
    final ctrl = ref.read(feedControllerProvider.notifier);

    return Scaffold(
      backgroundColor: Colors.black,
      body: Builder(builder: (_) {
        if (s.items.isEmpty) {
          if (s.error != null) {
            return Center(child: TextButton(onPressed: ctrl.retry, child: Text(s.error!, style: const TextStyle(color: Colors.white))));
          }
          if (s.loading) return const Center(child: CircularProgressIndicator());
          return const Center(child: Text('No videos yet. Be the first to post!', style: TextStyle(color: Colors.white70)));
        }
        return PageView.builder(
          scrollDirection: Axis.vertical,
          controller: _page,
          physics: const PageScrollPhysics(),
          itemCount: s.items.length,
          onPageChanged: ctrl.onPageChanged,
          itemBuilder: (_, i) => _VideoPage(item: s.items[i]),
        );
      }),
    );
  }
}

class _VideoPage extends ConsumerWidget {
  const _VideoPage({required this.item});
  final VideoItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pool = ref.watch(playerPoolProvider);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => pool.togglePlayback(item.id),
      child: Stack(fit: StackFit.expand, children: [
        // Poster shows instantly; the video fades in on top once the first frame is ready.
        if (item.thumbnailUrl != null)
          Image.network(item.thumbnailUrl!, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const ColoredBox(color: Colors.black)),
        ListenableBuilder(
          listenable: pool,
          builder: (context, _) {
            final c = pool.controllerFor(item.id);
            if (pool.hasFailed(item.id)) {
              return const Center(child: Icon(Icons.error_outline, color: Colors.white54, size: 40));
            }
            if (c == null || !c.value.isInitialized) {
              return const Align(alignment: Alignment.bottomCenter, child: LinearProgressIndicator(minHeight: 2));
            }
            return ValueListenableBuilder<VideoPlayerValue>(
              valueListenable: c,
              builder: (_, v, __) => Stack(fit: StackFit.expand, children: [
                AnimatedOpacity(
                  duration: const Duration(milliseconds: 150),
                  opacity: v.position > Duration.zero || v.isPlaying ? 1 : 0,
                  child: FittedBox(
                    fit: BoxFit.cover,
                    child: SizedBox(width: v.size.width, height: v.size.height, child: VideoPlayer(c)),
                  ),
                ),
                if (v.isBuffering) const Align(alignment: Alignment.bottomCenter, child: LinearProgressIndicator(minHeight: 2)),
                if (!v.isPlaying && v.position > Duration.zero)
                  const Center(child: Icon(Icons.play_arrow_rounded, color: Colors.white70, size: 72)),
              ]),
            );
          },
        ),
        Positioned(
          left: 16, right: 80, bottom: 32,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text('@${item.authorName}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16)),
            if (item.caption.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(item.caption, maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white)),
            ],
          ]),
        ),
      ]),
    );
  }
}
