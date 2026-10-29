// Pic de réservations sur les mêmes trajets : PASSENGERS passagers réservent 1 place en même temps sur
// chacun des trajets TRIPS. Attendu : jamais plus de places réservées que de places offertes.
//   docker run --rm --network host -v "$PWD/tests/charge:/scripts" -e API=http://127.0.0.1:3200 \
//     -e TRIPS='["<id>", ...]' grafana/k6 run /scripts/reservations.js
// L'API doit tourner hors production avec OTP_TEST_MODE=true (connexion par le code de test) et TRUST_PROXY=1.
// Passagers fictifs : numéros +225 00 00 00 00 50 à 89 (plage de démonstration, attribuée à aucun abonné).
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import exec from 'k6/execution';

const API = __ENV.API || 'http://127.0.0.1:3200';
const TRIPS = JSON.parse(__ENV.TRIPS);
const N = Number(__ENV.PASSENGERS || 40);
const created = new Counter('reservations_creees');
const refused = new Counter('reservations_refusees_complet');
const other = new Counter('reponses_inattendues');

export const options = {
  setupTimeout: '120s',
  scenarios: {
    pic: { executor: 'per-vu-iterations', vus: N, iterations: TRIPS.length, maxDuration: '2m' },
  },
  thresholds: { reponses_inattendues: ['count==0'] },
};

// Clé d'idempotence au format UUID v4 (exigée par l'API sur toute création).
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

const json = (ip, token) => ({
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
});

export function setup() {
  const users = [];
  for (let i = 0; i < N; i++) {
    const ip = `10.200.${Math.floor(i / 200)}.${(i % 200) + 1}`;
    const phone = `00000000${String(50 + i).padStart(2, '0')}`;
    const req = http.post(`${API}/api/v1/auth/otp/request`, JSON.stringify({ phone }), json(ip));
    if (req.status !== 200) throw new Error(`OTP ${phone} : ${req.status} ${req.body}`);
    const ver = http.post(
      `${API}/api/v1/auth/otp/verify`,
      JSON.stringify({ otpRequestId: req.json('otpRequestId'), code: req.json('testCode'), deviceLabel: 'k6' }),
      json(ip),
    );
    const token = ver.json('accessToken');
    if (!ver.json('user.profileComplete')) {
      http.patch(`${API}/api/v1/me`, JSON.stringify({ firstName: 'Essai-Charge', lastName: 'Passager' }), json(ip, token));
      for (const type of ['TERMS', 'PRIVACY']) {
        http.put(`${API}/api/v1/me/consents`, JSON.stringify({ type, version: '0.1-brouillon', granted: true }), json(ip, token));
      }
    }
    users.push({ token, ip });
  }
  const trips = TRIPS.map((id) => {
    const t = http.get(`${API}/api/v1/trips/${id}`).json();
    return { id, pickup: t.stops[0].id, dropoff: t.stops[t.stops.length - 1].id, seats: t.seatsOffered };
  });
  return { users, trips };
}

export default function (data) {
  const u = data.users[exec.vu.idInTest - 1];
  const t = data.trips[exec.vu.iterationInScenario];
  const res = http.post(
    `${API}/api/v1/bookings`,
    JSON.stringify({ tripId: t.id, pickupStopId: t.pickup, dropoffStopId: t.dropoff, seats: 1, acceptCancellationPolicy: true }),
    { headers: { ...json(u.ip, u.token).headers, 'Idempotency-Key': uuid() }, tags: { name: 'booking' } },
  );
  if (res.status === 201) created.add(1, { trip: t.id });
  else if (res.status === 409 && res.json('error.code') === 'SEATS_UNAVAILABLE') refused.add(1, { trip: t.id });
  else {
    other.add(1);
    console.error(`${res.status} ${res.body}`);
  }
  check(res, { '201 ou 409 complet': (r) => r.status === 201 || r.status === 409 });
}
