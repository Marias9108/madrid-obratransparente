#!/usr/bin/env python3
"""Simple tile proxy + HF inference proxy."""
import http.server
import urllib.request
import urllib.error
import json
import os
import sys

PROXY = 'http://proxy.sig.umbrella.com:443'
PORT = 3002
HF_TOKEN = os.environ.get('HF_TOKEN', '')
HF_MODEL = 'mistralai/Mistral-7B-Instruct-v0.3'
HF_URL = f'https://api-inference.huggingface.co/models/{HF_MODEL}'

import ssl

proxy_handler = urllib.request.ProxyHandler({
    'http': PROXY,
    'https': PROXY,
})
opener = urllib.request.build_opener(proxy_handler)

# Direct opener (no proxy) for HF API - corporate proxy blocks SSL to HF
no_proxy_handler = urllib.request.ProxyHandler({})
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE
hf_opener = urllib.request.build_opener(no_proxy_handler, urllib.request.HTTPSHandler(context=ssl_ctx))

class TileProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/chat':
            content_len = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_len)
            data = json.loads(body)
            messages = data.get('messages', [])
            system_ctx = data.get('system', '')

            prompt = '<s>'
            if system_ctx:
                prompt += f'[INST] {system_ctx}\n\n'
            else:
                prompt += '[INST] '
            for m in messages:
                if m['role'] == 'user':
                    prompt += m['content'] + ' [/INST]'
                elif m['role'] == 'assistant':
                    prompt += ' ' + m['content'] + '</s><s>[INST] '

            hf_payload = json.dumps({
                'inputs': prompt,
                'parameters': {
                    'max_new_tokens': 500,
                    'temperature': 0.7,
                    'top_p': 0.9,
                    'do_sample': True,
                    'return_full_text': False
                }
            }).encode()

            try:
                req = urllib.request.Request(HF_URL, data=hf_payload, headers={
                    'Authorization': f'Bearer {HF_TOKEN}',
                    'Content-Type': 'application/json',
                    'User-Agent': 'ObraTransparente/1.0'
                })
                resp = hf_opener.open(req, timeout=30)
                result = json.loads(resp.read())
                if isinstance(result, list) and len(result) > 0:
                    text = result[0].get('generated_text', '')
                else:
                    text = str(result)
                text = text.strip()
                reply = json.dumps({'reply': text}, ensure_ascii=False).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(reply)
            except Exception as e:
                print(f'HF API error: {e}', file=sys.stderr)
                err = json.dumps({'error': str(e)}).encode()
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(err)
        else:
            self.send_response(404)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

    def do_GET(self):
        # Extract path: /tiles/{s}/{z}/{x}/{y}.png -> build tile URL
        # Or /osm/{z}/{x}/{y}.png
        path = self.path
        
        if path.startswith('/carto/'):
            # /carto/light_all/{z}/{x}/{y}.png
            rest = path[len('/carto/'):]
            url = f'https://a.basemaps.cartocdn.com/{rest}'
        elif path.startswith('/osm/'):
            rest = path[len('/osm/'):]
            url = f'https://tile.openstreetmap.org/{rest}'
        elif path.startswith('/stamen/'):
            rest = path[len('/stamen/'):]
            url = f'https://tiles.stadiamaps.com/tiles/{rest}'
        else:
            self.send_response(404)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'Unknown tile path')
            return

        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 TileProxy/1.0'
            })
            resp = opener.open(req, timeout=10)
            data = resp.read()
            
            self.send_response(200)
            self.send_header('Content-Type', resp.headers.get('Content-Type', 'image/png'))
            self.send_header('Cache-Control', 'public, max-age=86400')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            print(f'Error fetching {url}: {e}', file=sys.stderr)
            self.send_response(502)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(f'Error: {e}'.encode())

    def log_message(self, format, *args):
        # Suppress default logging for cleaner output
        pass

if __name__ == '__main__':
    server = http.server.HTTPServer(('0.0.0.0', PORT), TileProxyHandler)
    print(f'Tile+HF proxy running on http://localhost:{PORT}')
    print(f'  Carto tiles: http://localhost:{PORT}/carto/light_all/{{z}}/{{x}}/{{y}}.png')
    print(f'  HF chat:     POST http://localhost:{PORT}/api/chat')
    server.serve_forever()
