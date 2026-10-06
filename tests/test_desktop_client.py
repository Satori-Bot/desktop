import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mcp_desktop_client.app import find_native_app, main


class NativeLauncherTests(unittest.TestCase):
    def test_explicit_existing_binary_is_used(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'desktop app'
            binary.touch()
            with patch.dict('os.environ', {'CODING_TOOLS_MCP_DESKTOP_BINARY': str(binary)}):
                self.assertEqual(find_native_app(), binary)

    def test_missing_override_does_not_fall_back(self):
        with patch.dict('os.environ', {'CODING_TOOLS_MCP_DESKTOP_BINARY': '/missing/desktop'}):
            self.assertIsNone(find_native_app())

    def test_launch_passes_argument_list_without_shell(self):
        with (
            patch('mcp_desktop_client.app.find_native_app', return_value=Path('/app with spaces')),
            patch('mcp_desktop_client.app.subprocess.Popen') as spawn,
            patch('sys.argv', ['coding-tools-mcp-desktop', '--argument']),
        ):
            self.assertEqual(main(), 0)
            spawn.assert_called_once_with([str(Path('/app with spaces')), '--argument'], close_fds=True)

    def test_missing_native_app_has_actionable_error(self):
        with (
            patch('mcp_desktop_client.app.find_native_app', return_value=None),
            patch('sys.stderr.write') as write,
        ):
            self.assertEqual(main(), 1)
            self.assertIn('compatibility launcher', ''.join(args[0] for args, _ in write.call_args_list))

    def test_launch_error_is_reported(self):
        with (
            patch('mcp_desktop_client.app.find_native_app', return_value=Path('/app')),
            patch('mcp_desktop_client.app.subprocess.Popen', side_effect=OSError('denied')),
            patch('sys.stderr.write'),
        ):
            self.assertEqual(main(), 1)


if __name__ == '__main__':
    unittest.main()
