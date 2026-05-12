#!/usr/bin/env python3
"""Minimal static file server for the terrarium app."""

import http.server
import socket
import socketserver
import os
import sys

HOST = "0.0.0.0"
PORT = 1999
DIR = os.path.dirname(os.path.abspath(__file__))


def local_ipv4s():
    addrs = set()
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            addrs.add(info[4][0])
    except socket.gaierror:
        pass
    # also discover the outbound interface address
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        addrs.add(s.getsockname()[0])
    except OSError:
        pass
    finally:
        s.close()
    return sorted(a for a in addrs if not a.startswith("127."))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def end_headers(self):
        # Disable caching so edits show up immediately during dev.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with ReusableTCPServer((HOST, PORT), Handler) as httpd:
        print(f"terrarium listening on {HOST}:{PORT} (all interfaces)")
        print(f"  → http://localhost:{PORT}")
        for ip in local_ipv4s():
            print(f"  → http://{ip}:{PORT}")
        sys.stdout.flush()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nshutting down.")
            httpd.shutdown()
