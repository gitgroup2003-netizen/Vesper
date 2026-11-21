# Vesper: M1 + M2 scaffold

Auth (phone OTP) -> resumable upload -> transcode -> HLS playback in a vertical feed.

```
backend/   NestJS (Fastify) modular monolith: auth, videos, feed, events
mobile/    Flutter app: feed + player pool + prefetch, telemetry buffer, resumable uploader, login
docs/      openapi.yaml (contract for everything implemented here)
```

## Run the backend locally
```bash
cd backend
cp .env.example .env            # set JWT_SECRET and OTP_SECRET to long random strings
docker compose up -d            # postgres, redis, minio (+ public-read bucket)
npm install
npm run migrate
npm run dev                     # http://localhost:3000/v1/health
```
With `TRANSCODER=dev` the raw MP4 is played straight from MinIO (no HLS), so you can test the whole loop with no cloud account.
OTP codes are printed in the API log (`[DEV SMS]`).

## Run the app
```bash
cd mobile
flutter create . --platforms=android,ios --project-name vesper   # generates android/ios folders; keeps lib/ and pubspec
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:3000/v1        # Android emulator -> host machine
```
Android needs `<uses-permission android:name="android.permission.INTERNET"/>` (default in debug) and, for local HTTP,
`android:usesCleartextTraffic="true"` on `<application>` in the debug manifest. Use HTTPS in production.

## Production switch (Cloudflare R2 + Stream)
1. R2 bucket + API token; set `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=false`.
2. `TRANSCODER=cloudflare` plus `CF_ACCOUNT_ID`, `CF_STREAM_API_TOKEN`, `CF_STREAM_CUSTOMER_CODE`.
3. Register the webhook once and copy the returned `secret` into `CF_STREAM_WEBHOOK_SECRET`:
   `curl -X PUT https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/stream/webhook -H "Authorization: Bearer $CF_STREAM_API_TOKEN" -d '{"notificationUrl":"https://api.yourdomain.com/v1/webhooks/transcoder"}'`
4. Add an R2 lifecycle rule to expire `raw/` objects after ~7 days (Stream keeps the transcoded copy).
5. Replace `ConsoleSmsSender` with a real SMS adapter (Africa's Talking is a good fit for Uganda).

## Deliberate MVP shortcuts (each sits behind an interface)
| Piece | Now | Replaced by |
|---|---|---|
| Moderator | `AutoApproveModerator` (approves all) | NSFW/audio-match adapters + review queue (M5) |
| Feed ranker | Reverse-chronological | Candidate generation + ranking (M4) |
| Transcoder | Cloudflare Stream / dev | Self-hosted FFmpeg workers if volume justifies |
| SMS | Console logger | Africa's Talking adapter |
| Schema | Only users, refresh_tokens, videos | Full data model in the database phase |
