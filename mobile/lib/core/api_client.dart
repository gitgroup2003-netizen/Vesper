import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const _apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3000/v1');

class TokenStore {
  const TokenStore();
  static const _s = FlutterSecureStorage();
  Future<String?> get access => _s.read(key: 'access');
  Future<String?> get refresh => _s.read(key: 'refresh');
  Future<void> save(String access, String refresh) async {
    await _s.write(key: 'access', value: access);
    await _s.write(key: 'refresh', value: refresh);
  }

  Future<void> clear() async {
    await _s.delete(key: 'access');
    await _s.delete(key: 'refresh');
  }
}

/// Dio client with bearer auth and single-flight refresh-on-401.
class ApiClient {
  ApiClient(this.tokens, {String baseUrl = _apiUrl})
      : dio = Dio(BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 20),
          headers: {'Accept': 'application/json'},
        )) {
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (o, h) async {
        final t = await tokens.access;
        if (t != null && !o.path.startsWith('/auth/')) o.headers['Authorization'] = 'Bearer $t';
        h.next(o);
      },
      onError: (e, h) async {
        final isAuthCall = e.requestOptions.path.startsWith('/auth/');
        if (e.response?.statusCode != 401 || isAuthCall || e.requestOptions.extra['retried'] == true) {
          return h.next(e);
        }
        if (!await _refreshOnce()) return h.next(e);
        final opts = e.requestOptions..extra['retried'] = true;
        try {
          h.resolve(await dio.fetch(opts));
        } on DioException catch (e2) {
          h.next(e2);
        }
      },
    ));
  }

  final TokenStore tokens;
  final Dio dio;
  Future<bool>? _refreshing;

  Future<bool> _refreshOnce() => _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);

  Future<bool> _doRefresh() async {
    final refresh = await tokens.refresh;
    if (refresh == null) return false;
    try {
      final res = await dio.post('/auth/refresh', data: {'refreshToken': refresh});
      await tokens.save(res.data['accessToken'] as String, res.data['refreshToken'] as String);
      return true;
    } on DioException {
      await tokens.clear();
      return false;
    }
  }

  // --- Auth ---
  Future<void> requestOtp(String phone) => dio.post('/auth/otp/request', data: {'phone': phone});

  Future<bool> verifyOtp(String phone, String code) async {
    final res = await dio.post('/auth/otp/verify', data: {'phone': phone, 'code': code});
    await tokens.save(res.data['accessToken'] as String, res.data['refreshToken'] as String);
    return res.data['isNewUser'] as bool;
  }
}
