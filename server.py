#!/usr/bin/env python3
"""STCP GO - lightweight, dependency-free PWA API server.

Downloads the official, public STCP GTFS file from the Porto open-data catalogue.
Distinguishes scheduled GTFS arrivals from live bus GPS positions (FIWARE).
No secret keys, tracking or fabricated arrival estimates.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, date, time as dt_time, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
PUBLIC = HERE / 'public'
CACHE = HERE / '.cache'
TZ = ZoneInfo('Europe/Lisbon')
PORT = int(os.environ.get('PORT', '8765'))
GTFS_SLUG = 'horarios-paragens-e-rotas-em-formato-gtfs-stcp'
BROKER = 'https://broker.fiware.urbanplatform.portodigital.pt/v2/entities?q=vehicleType%3D%3Dbus&limit=1000'
HEADERS = {'User-Agent': 'STCP-GO/1.0 (+local transport PWA)', 'Accept': 'application/json, */*'}
SIZE_LIMIT = 45 * 1024 * 1024


def get_url(url, timeout=22, max_bytes=SIZE_LIMIT):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise RuntimeError('Resposta demasiado grande')
        return data


def pick_resource(resources):
    candidates = [r for r in resources if isinstance(r, dict) and (
        str(r.get('format', '')).upper() in ('ZIP', 'GTFS') or '.zip' in str(r.get('url', '')).lower()
    ) and r.get('url') and not r.get('url', '').startswith('http://')]
    if not candidates:
        raise RuntimeError('Não foi encontrado um recurso GTFS ZIP no catálogo.')

    def score(r):
        name = f"{r.get('name','')} {r.get('description','')}".lower()
        dmy = re.findall(r'(\d{2})[-_/](\d{2})[-_/](20\d{2})', name)
        date_key = ''.join(reversed(dmy[-1])) if dmy else ''
        return (1 if ('mais recente' in name or 'latest' in name) else 0,
                date_key, str(r.get('last_modified') or r.get('created') or ''))

    return sorted(candidates, key=score, reverse=True)[0]


def locate_gtfs():
    override = os.environ.get('STCP_GTFS_URL', '').strip()
    if override:
        return override, 'URL configurado manualmente'

    bases = ('https://dadosabertos.cm-porto.pt', 'https://opendata.porto.digital')
    errors = []
    for base in bases:
        urls = [f'{base}/api/3/action/package_show?id={urllib.parse.quote(GTFS_SLUG)}',
                f'{base}/api/3/action/package_search?q=horarios+paragens+rotas+STCP&rows=30']
        for url in urls:
            try:
                obj = json.loads(get_url(url, max_bytes=5_000_000).decode('utf-8'))
                if not obj.get('success'):
                    continue
                result = obj['result']
                packs = result.get('results', []) if isinstance(result, dict) and 'results' in result else [result]
                for pack in packs:
                    title = str(pack.get('title', '')).lower()
                    slug = str(pack.get('name', '')).lower()
                    if 'stcp' not in title and 'stcp' not in slug:
                        continue
                    resource = pick_resource(pack.get('resources', []))
                    return resource['url'], resource.get('name') or pack.get('title') or 'STCP GTFS'
            except Exception as exc:
                errors.append(str(exc)[:90])
    raise RuntimeError('Não foi possível consultar o catálogo GTFS da STCP. ' + '; '.join(errors[-2:]))


def parse_csv(archive, name):
    candidates = [n for n in archive.namelist() if n.lower().endswith('/'+name) or n.lower() == name]
    if not candidates:
        return iter(())
    stream = io.TextIOWrapper(archive.open(candidates[0]), encoding='utf-8-sig', newline='')
    return csv.DictReader(stream)


def to_sec(hms):
    try:
        h, m, s = map(int, hms.split(':'))
        return h * 3600 + m * 60 + s
    except (ValueError, AttributeError):
        return None


def norm(s):
    return re.sub(r'\s+', ' ', (s or '').strip())


class GTFS:
    def __init__(self, payload):
        self.stops = {}
        self.routes = {}
        self.trips = {}
        self.active_week = {}
        self.exceptions = defaultdict(dict)
        self.timetable = defaultdict(list)
        self.patterns = defaultdict(dict)
        self.stop_lines = defaultdict(set)
        self.trip_stop_times = defaultdict(list)
        self.loaded_at = datetime.now(TZ).isoformat()
        self.feed_valid = None
        with zipfile.ZipFile(io.BytesIO(payload)) as z:
            for r in parse_csv(z, 'stops.txt'):
                sid = r.get('stop_id')
                if not sid:
                    continue
                try:
                    lat = float(r.get('stop_lat') or 0)
                    lon = float(r.get('stop_lon') or 0)
                except ValueError:
                    lat = lon = 0
                self.stops[sid] = {'id': sid, 'name': norm(r.get('stop_name')),
                                    'code': norm(r.get('stop_code')) or sid,
                                    'lat': lat, 'lon': lon, 'zone': r.get('zone_id') or ''}
            for r in parse_csv(z, 'routes.txt'):
                rid = r.get('route_id')
                if rid:
                    self.routes[rid] = {'id': rid, 'number': norm(r.get('route_short_name')) or rid,
                                        'name': norm(r.get('route_long_name')),
                                        'color': r.get('route_color') or '2272E5'}
            for r in parse_csv(z, 'trips.txt'):
                tid = r.get('trip_id')
                if tid and r.get('route_id') in self.routes:
                    self.trips[tid] = {'route': r['route_id'], 'service': r.get('service_id') or '',
                                       'direction': str(r.get('direction_id') or '0'),
                                       'headsign': norm(r.get('trip_headsign'))}
            for r in parse_csv(z, 'calendar.txt'):
                self.active_week[r['service_id']] = (
                    r.get('start_date') or '00000101', r.get('end_date') or '99991231',
                    tuple(r.get(day) == '1' for day in
                          ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')))
            for r in parse_csv(z, 'calendar_dates.txt'):
                if r.get('service_id') and r.get('date'):
                    self.exceptions[r['service_id']][r['date']] = str(r.get('exception_type')) == '1'
            for r in parse_csv(z, 'stop_times.txt'):
                tid, sid = r.get('trip_id'), r.get('stop_id')
                if tid not in self.trips or sid not in self.stops:
                    continue
                sec = to_sec(r.get('departure_time') or r.get('arrival_time'))
                if sec is None:
                    continue
                try:
                    seq = int(r.get('stop_sequence') or 0)
                except ValueError:
                    seq = 0
                self.timetable[sid].append((sec, tid, seq))
                self.trip_stop_times[tid].append((seq, sid, sec))
                self.stop_lines[sid].add(self.trips[tid]['route'])
        if not self.stops or not self.trips or not self.timetable:
            raise RuntimeError('GTFS incompleto: faltam paragens, viagens ou horários.')
        for sid in self.timetable:
            self.timetable[sid].sort()
        # Select the longest real trip as route / direction representative, never guess a path.
        for tid, stops in self.trip_stop_times.items():
            trip = self.trips[tid]
            key = (trip['direction'], trip['headsign'] or '')
            rid = trip['route']
            if key not in self.patterns[rid] or len(stops) > len(self.patterns[rid][key]):
                self.patterns[rid][key] = sorted(stops)
        self.services_cache = {}
        del self.trip_stop_times

    def service_active(self, service, localdate):
        ds = localdate.strftime('%Y%m%d')
        if ds in self.exceptions.get(service, {}):
            return self.exceptions[service][ds]
        cal = self.active_week.get(service)
        return bool(cal and cal[0] <= ds <= cal[1] and cal[2][localdate.weekday()])

    def arrivals(self, sid, line='', limit=20, now=None):
        now = now or datetime.now(TZ)
        out = []
        for delta in (-1, 0, 1):
            d = now.date() + timedelta(days=delta)
            anchor = datetime.combine(d, dt_time(0), tzinfo=TZ)
            base = anchor.timestamp()
            active = {svc for svc in set(t['service'] for t in self.trips.values()) if self.service_active(svc, d)}
            if not active:
                continue
            for sec, tid, seq in self.timetable.get(sid, []):
                trip = self.trips[tid]
                if trip['service'] not in active or (line and line not in (trip['route'], self.routes[trip['route']]['number'])):
                    continue
                timestamp = base + sec
                wait = round((timestamp - now.timestamp()) / 60, 1)
                if -1 <= wait <= 170:
                    out.append({'line': self.routes[trip['route']]['number'], 'route_id': trip['route'],
                                'destination': trip['headsign'] or self.routes[trip['route']]['name'],
                                'minutes': max(0, int(round(wait))), 'time': datetime.fromtimestamp(timestamp, TZ).strftime('%H:%M'),
                                'timestamp': int(timestamp), 'kind': 'scheduled'})
        out.sort(key=lambda e: e['timestamp'])
        # Some feeds contain duplicate trips across schedule variants; retain exact scheduled events.
        return out[:limit]

    def patterns_for(self, rid):
        result = []
        for (direction, headsign), seq in self.patterns.get(rid, {}).items():
            ids = [x[1] for x in seq]
            if ids:
                result.append({'direction': direction, 'headsign': headsign or self.stops[ids[-1]]['name'],
                               'stops': ids})
        result.sort(key=lambda x: (x['direction'], -len(x['stops'])))
        return result


state = {'data': None, 'error': '', 'status': 'a carregar', 'source': '', 'download': ''}
lock = threading.RLock()
last_vehicle = {'timestamp': 0, 'data': None, 'error': ''}


def load_gtfs():
    CACHE.mkdir(exist_ok=True)
    cached_file = CACHE / 'stcp-gtfs.zip'
    if cached_file.exists():
        try:
            gtfs = GTFS(cached_file.read_bytes())
            with lock:
                state.update(data=gtfs, status='pronto', error='', source='Cache local STCP')
        except Exception as exc:
            with lock:
                state['error'] = f'Cache: {exc}'
    try:
        url, source = locate_gtfs()
        payload = get_url(url)
        gtfs = GTFS(payload)
        with lock:
            state.update(data=gtfs, status='pronto', error='', source=source, download=url)
        # Do not discard a working cache on a truncated/malformed download.
        tmp = cached_file.with_suffix('.tmp')
        tmp.write_bytes(payload)
        tmp.replace(cached_file)
    except Exception as exc:
        with lock:
            if state['data'] is None:
                state.update(status='indisponível', error=str(exc))
            else:
                state['error'] = 'Não foi possível atualizar o GTFS; a usar a última versão guardada.'


def get_vehicles():
    with lock:
        if time.time() - last_vehicle['timestamp'] < 25:
            return dict(last_vehicle)
    try:
        raw = json.loads(get_url(BROKER, timeout=12, max_bytes=9_000_000).decode('utf-8'))
        if not isinstance(raw, list):
            raise RuntimeError('O servidor GPS devolveu uma resposta inesperada.')
        vehicles = []
        for item in raw:
            def val(k):
                d = item.get(k)
                return d.get('value') if isinstance(d, dict) else d
            loc = val('location') or {}
            coords = loc.get('coordinates', []) if isinstance(loc, dict) else []
            if len(coords) < 2:
                continue
            try:
                lon, lat = float(coords[0]), float(coords[1])
            except (TypeError, ValueError):
                continue
            if not (40.6 <= lat <= 42 and -9.3 <= lon <= -7.7):
                continue
            rid = str(val('route') or val('routeId') or val('line') or val('serviceProvided') or '')
            obs = val('dateObserved') or val('dateModified') or val('timestamp') or ''
            if isinstance(obs, str) and obs:
                try:
                    observed_at = datetime.fromisoformat(obs.replace('Z', '+00:00'))
                    if observed_at.tzinfo and abs(time.time() - observed_at.timestamp()) > 900:
                        continue  # Never display a GPS record older than 15 minutes as live.
                except ValueError:
                    pass
            vehicles.append({'id': str(item.get('id', ''))[-100:], 'lat': lat, 'lon': lon,
                             'line': rid[:60], 'observed': str(obs)[:50]})
        output = {'timestamp': time.time(), 'data': vehicles, 'error': ''}
    except Exception as exc:
        output = {'timestamp': time.time(), 'data': None, 'error': str(exc)}
    with lock:
        last_vehicle.update(output)
    return output


def route_journeys(db, frm, to):
    if frm == to:
        return []
    patterns = []
    for rid in db.stop_lines.get(frm, set()) | db.stop_lines.get(to, set()):
        for p in db.patterns_for(rid):
            patterns.append((rid, p))
    # A transfer route may be outside origin/destination routes.
    starts, ends = [], []
    direct = []
    for rid in db.stop_lines.get(frm, []):
        for p in db.patterns_for(rid):
            if frm in p['stops']:
                starts.append((rid, p))
    for rid in db.stop_lines.get(to, []):
        for p in db.patterns_for(rid):
            if to in p['stops']:
                ends.append((rid, p))
    for rid, p in starts:
        a = p['stops'].index(frm)
        if to in p['stops'] and p['stops'].index(to) > a:
            b = p['stops'].index(to)
            direct.append({'transfers': 0, 'stops': b - a, 'lines': [db.routes[rid]['number']],
                           'route_ids': [rid], 'via': None, 'endpoints': [frm, to]})
    if direct:
        return sorted(direct, key=lambda x: x['stops'])[:6]
    # First practical one-transfer journey. No claim about schedule transfer coordination.
    results = []
    for r1, p1 in starts[:55]:
        a = p1['stops'].index(frm)
        tail = p1['stops'][a + 1:]
        for r2, p2 in ends[:55]:
            if r1 == r2:
                continue
            b = p2['stops'].index(to)
            eligible = set(p2['stops'][:b])
            for i, sid in enumerate(tail):
                if sid in eligible:
                    j = p2['stops'].index(sid)
                    results.append({'transfers': 1, 'stops': i + 1 + b - j,
                                    'lines': [db.routes[r1]['number'], db.routes[r2]['number']],
                                    'route_ids': [r1, r2], 'via': db.stops[sid],
                                    'endpoints': [frm, to]})
                    break
    return sorted(results, key=lambda x: x['stops'])[:6]


class Handler(BaseHTTPRequestHandler):
    server_version = 'STCPGO/1.0'

    def log_message(self, fmt, *args):
        print('%s %s' % (self.address_string(), fmt % args))

    def json_out(self, obj, status=200):
        payload = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(parsed.query)
        arg = lambda k, default='': q.get(k, [default])[0]
        path = parsed.path
        if not path.startswith('/api/'):
            self.serve_static(path)
            return
        try:
            if path == '/api/status':
                with lock:
                    db = state['data']
                    response = {'status': state['status'], 'error': state['error'], 'source': state['source'],
                                'updated': db.loaded_at if db else None, 'stops': len(db.stops) if db else 0,
                                'routes': len(db.routes) if db else 0}
                return self.json_out(response)
            if path == '/api/vehicles':
                result = get_vehicles()
                return self.json_out({'vehicles': result['data'], 'error': result['error'],
                                      'source': 'Porto Digital / FIWARE',
                                      'updated': datetime.fromtimestamp(result['timestamp'], TZ).isoformat()})
            with lock:
                db = state['data']
            if db is None:
                return self.json_out({'error': 'Os dados de horários ainda não estão disponíveis.', 'status': state['status']}, 503)
            if path == '/api/stops':
                term = norm(arg('q')).casefold()
                lat, lon = arg('lat'), arg('lon')
                if lat and lon:
                    from math import cos, radians
                    latf, lonf = float(lat), float(lon)
                    if not (40 <= latf <= 43 and -11 <= lonf <= -6):
                        return self.json_out({'stops': []})
                    stops = sorted((s for s in db.stops.values() if s['lat'] and s['lon']),
                                   key=lambda s: (s['lat'] - latf)**2 + ((s['lon'] - lonf)*cos(radians(latf)))**2)[:30]
                elif term:
                    stops = [s for s in db.stops.values() if term in (s['name'] + ' ' + s['code'] + ' ' + s['id']).casefold()][:60]
                else:
                    stops = []
                return self.json_out({'stops': [dict(s, lines=sorted(db.routes[r]['number'] for r in db.stop_lines[s['id']])) for s in stops]})
            if path == '/api/routes':
                term = norm(arg('q')).casefold()
                routes = list(db.routes.values())
                if term:
                    routes = [r for r in routes if term in (r['number'] + ' ' + r['name']).casefold()]
                routes.sort(key=lambda r: r['number'])
                return self.json_out({'routes': routes[:150]})
            if path == '/api/stop':
                sid = arg('id')
                stop = db.stops.get(sid)
                if not stop:
                    stop = next((s for s in db.stops.values() if s['code'].casefold() == sid.casefold()), None)
                if not stop:
                    return self.json_out({'error': 'Paragem não encontrada.'}, 404)
                return self.json_out({'stop': stop,
                                      'lines': [db.routes[r] for r in sorted(db.stop_lines[stop['id']])],
                                      'arrivals': db.arrivals(stop['id'], arg('line'), 35),
                                      'source': 'GTFS STCP / horários programados',
                                      'official': 'https://stcp.pt/pt/paragem?stop=' + urllib.parse.quote(stop['code'])})
            if path == '/api/route':
                rid = arg('id')
                if rid not in db.routes:
                    return self.json_out({'error': 'Linha não encontrada.'}, 404)
                variants = []
                for p in db.patterns_for(rid):
                    variants.append({'direction': p['direction'], 'headsign': p['headsign'],
                                     'stops': [db.stops[sid] for sid in p['stops'] if sid in db.stops]})
                return self.json_out({'route': db.routes[rid], 'variants': variants})
            if path == '/api/journey':
                start, end = arg('from'), arg('to')
                if start not in db.stops or end not in db.stops:
                    return self.json_out({'error': 'Escolhe duas paragens válidas.'}, 400)
                return self.json_out({'results': route_journeys(db, start, end),
                                      'from': db.stops[start], 'to': db.stops[end]})
            if path == '/api/reload':
                threading.Thread(target=load_gtfs, daemon=True).start()
                return self.json_out({'status': 'a atualizar'})
            return self.json_out({'error': 'Endpoint desconhecido'}, 404)
        except (KeyError, ValueError, TypeError) as exc:
            return self.json_out({'error': 'Pedido inválido: ' + str(exc)[:150]}, 400)
        except Exception as exc:
            print('ERRO', repr(exc))
            return self.json_out({'error': 'Ocorreu um erro ao processar o pedido.'}, 500)

    def serve_static(self, path):
        mapping = {'/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js',
                   '/style.css': 'style.css', '/manifest.webmanifest': 'manifest.webmanifest',
                   '/sw.js': 'sw.js', '/icon.svg': 'icon.svg', '/icon-180.png': 'icon-180.png', '/icon-192.png': 'icon-192.png', '/icon-512.png': 'icon-512.png'}
        name = mapping.get(path)
        if not name:
            return self.send_error(404)
        f = PUBLIC / name
        if not f.exists():
            return self.send_error(404)
        contents = f.read_bytes()
        content_type = {'html': 'text/html', 'css': 'text/css', 'js': 'text/javascript',
                        'webmanifest': 'application/manifest+json', 'svg': 'image/svg+xml', 'png': 'image/png'}[name.rsplit('.', 1)[-1]]
        self.send_response(200)
        self.send_header('Content-Type', content_type + '; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache' if name in ('index.html', 'sw.js') else 'public, max-age=3600')
        self.send_header('Content-Length', str(len(contents)))
        self.end_headers()
        self.wfile.write(contents)


def main():
    threading.Thread(target=load_gtfs, daemon=True).start()
    srv = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'STCP GO: http://localhost:{PORT}  (CTRL+C para terminar)')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('A terminar.')
    finally:
        srv.server_close()

if __name__ == '__main__':
    main()
