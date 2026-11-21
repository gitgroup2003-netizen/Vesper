class VideoItem {
  const VideoItem({
    required this.id,
    required this.hlsUrl,
    required this.caption,
    required this.authorName,
    this.thumbnailUrl,
    this.durationMs,
  });

  final String id;
  final String hlsUrl;
  final String caption;
  final String authorName;
  final String? thumbnailUrl;
  final int? durationMs;

  factory VideoItem.fromJson(Map<String, dynamic> j) {
    final author = j['author'] as Map<String, dynamic>;
    return VideoItem(
      id: j['id'] as String,
      hlsUrl: j['hlsUrl'] as String,
      caption: (j['caption'] as String?) ?? '',
      thumbnailUrl: j['thumbnailUrl'] as String?,
      durationMs: j['durationMs'] as int?,
      authorName: (author['username'] ?? author['displayName'] ?? 'vesper_user') as String,
    );
  }

  /// With Data Saver on, hint a low starting bandwidth (Cloudflare Stream honours clientBandwidthHint in Mbps)
  /// so the first segments come from a low rendition and the player only climbs if the network allows.
  String playbackUrl({required bool dataSaver}) {
    if (!dataSaver || !hlsUrl.contains('.m3u8')) return hlsUrl;
    return hlsUrl.contains('?') ? '$hlsUrl&clientBandwidthHint=1.0' : '$hlsUrl?clientBandwidthHint=1.0';
  }
}

class FeedPage {
  const FeedPage(this.items, this.nextCursor);
  final List<VideoItem> items;
  final String? nextCursor;
}
