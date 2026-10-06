import runpy
import socket
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch


class HTTPFixtureTests(unittest.TestCase):
    def test_loopback_fixture_binds_without_reverse_dns(self):
        fixture = (
            Path(__file__).resolve().parents[1]
            / 'crates/desktop-manager/tests/fixtures/fake_core.py'
        )
        listeners = []

        def inspect_listener(server):
            try:
                self.assertEqual(server.server_name, '127.0.0.1')
                self.assertGreater(server.server_port, 0)
                with socket.create_connection(server.server_address, timeout=1):
                    listeners.append(server.server_address)
            finally:
                server.server_close()

        with (
            patch('sys.argv', [str(fixture), '--host', '127.0.0.1', '--port', '0']),
            patch('socket.getfqdn', side_effect=AssertionError('Fixture must not depend on DNS')) as lookup,
            patch.object(ThreadingHTTPServer, 'serve_forever', inspect_listener),
        ):
            runpy.run_path(str(fixture), run_name='__main__')
            lookup.assert_not_called()
        self.assertEqual(len(listeners), 1)


if __name__ == '__main__':
    unittest.main()
