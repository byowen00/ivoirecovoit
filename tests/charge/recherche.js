// Test de charge de la recherche (ENF-01 : p95 < 800 ms côté serveur pour 50 000 trajets publiés).
//   docker run --rm --network host -v "$PWD/tests/charge:/scripts" -e API=http://127.0.0.1:3200 \
//     -e PLACES='[...]' grafana/k6 run /scripts/recherche.js
// PLACES : identifiants des lieux (voir README.md). Chaque utilisateur virtuel simule une adresse IP
// différente (X-Forwarded-For, l'API doit avoir TRUST_PROXY=1), comme des clients réels derrière le proxy.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const API = __ENV.API || 'http://127.0.0.1:3200';
const P = JSON.parse(__ENV.PLACES); // { abidjan: [...], cities: [...] }
const results = new Trend('resultats_par_page');
// THINK=0 : sans pause entre deux recherches (mesure du débit maximal).
const THINK = __ENV.THINK === undefined ? 1 : Number(__ENV.THINK);

export const options = {
  scenarios: {
    recherche: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { duration: '30s', target: 25 },
        { duration: '1m', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_duration{name:search}': ['p(95)<800'],
    'http_req_failed{name:search}': ['rate<0.01'],
  },
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export default function () {
  // 60 % des recherches partent d'Abidjan (quartier, commune ou ville), 40 % entre deux villes.
  const from = Math.random() < 0.6 ? pick(P.abidjan) : pick(P.cities);
  let to = pick(P.cities);
  if (to === from) to = P.cities[(P.cities.indexOf(to) + 1) % P.cities.length];
  const day = new Date(Date.now() + (1 + Math.floor(Math.random() * 25)) * 86400000).toISOString().slice(0, 10);
  const sort = pick(['departure', 'departure', 'price', 'distance']);
  const res = http.get(`${API}/api/v1/trips/search?fromPlaceId=${from}&toPlaceId=${to}&date=${day}&seats=1&sort=${sort}`, {
    headers: { 'X-Forwarded-For': `10.${__VU % 250}.${Math.floor(Math.random() * 250)}.${(__ITER % 250) + 1}` },
    tags: { name: 'search' },
  });
  check(res, { 'statut 200': (r) => r.status === 200 });
  if (res.status === 200) results.add(res.json('data').length);
  if (THINK > 0) sleep(THINK * (0.5 + Math.random()));
}
