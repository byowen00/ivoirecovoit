import '../../core/api_client.dart';
import 'auth_session.dart';
import 'models.dart';

class AuthRepository {
  AuthRepository(this.api, this.session);

  final ApiClient api;
  final AuthSession session;

  Future<OtpRequest> requestOtp(String localDigits, {String? deviceId}) async {
    final res = await api.send('POST', '/auth/otp/request',
        body: {'phone': '+225$localDigits', 'purpose': 'LOGIN'},
        headers: deviceId == null ? null : {'X-Device-Id': deviceId});
    return OtpRequest.fromJson(res, DateTime.now());
  }

  Future<Me> verifyOtp(String otpRequestId, String code, String deviceLabel) async {
    final res = await api.send('POST', '/auth/otp/verify',
        body: {'otpRequestId': otpRequestId, 'code': code, 'deviceLabel': deviceLabel});
    await session.save(res);
    return Me.fromJson(res['user'] as Map<String, dynamic>);
  }

  Future<Me> me() async => Me.fromJson(await session.send('GET', '/me'));

  Future<Me> updateProfile(Map<String, Object?> patch) async => Me.fromJson(await session.send('PATCH', '/me', body: patch));

  Future<Me> consent(String type, String version, bool granted) async => Me.fromJson(
      await session.send('PUT', '/me/consents', body: {'type': type, 'version': version, 'granted': granted}));

  Future<({String name, String phone})?> emergencyContact() async {
    final data = (await session.send('GET', '/me/emergency-contact'))['data'] as Map<String, dynamic>?;
    return data == null ? null : (name: data['name'] as String, phone: data['phone'] as String);
  }

  Future<void> setEmergencyContact(String name, String phone) =>
      session.send('PUT', '/me/emergency-contact', body: {'name': name, 'phone': phone});

  Future<List<SessionInfo>> sessions() async => [
        for (final s in (await session.send('GET', '/auth/sessions'))['data'] as List)
          SessionInfo.fromJson(s as Map<String, dynamic>)
      ];

  Future<void> revokeSession(String id) => session.send('DELETE', '/auth/sessions/$id');

  Future<void> logout({bool everywhere = false}) async {
    try {
      await session.send(everywhere ? 'DELETE' : 'POST', everywhere ? '/auth/sessions/all' : '/auth/logout');
    } on ApiException {
      // La session locale est effacée dans tous les cas.
    } finally {
      await session.clear();
    }
  }

  Future<OtpRequest> deletionOtp() async =>
      OtpRequest.fromJson(await session.send('POST', '/me/deletion/otp'), DateTime.now());

  Future<void> deleteAccount(String otpRequestId, String code) async {
    await session.send('DELETE', '/me', body: {'otpRequestId': otpRequestId, 'code': code});
    await session.clear();
  }
}
