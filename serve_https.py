#!/usr/bin/env python3
import http.server
import os
import socket
import ssl
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CERT = ROOT / ".loopcoach-cert.pem"
KEY = ROOT / ".loopcoach-key.pem"
PORT = int(os.environ.get("PORT", "5443"))


def lan_ip():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def ensure_cert():
    if CERT.exists() and KEY.exists():
        return
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            str(KEY),
            "-out",
            str(CERT),
            "-days",
            "30",
            "-subj",
            "/CN=LoopCoach Local",
        ],
        check=True,
        cwd=ROOT,
    )


def main():
    ensure_cert()
    os.chdir(ROOT)
    handler = http.server.SimpleHTTPRequestHandler
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=CERT, keyfile=KEY)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    ip = lan_ip()
    print(f"LoopCoach HTTPS server")
    print(f"Local:   https://localhost:{PORT}")
    print(f"Phone:   https://{ip}:{PORT}")
    print("Your browser may show a certificate warning for this local prototype.")
    server.serve_forever()


if __name__ == "__main__":
    main()
