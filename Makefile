PYTHON ?= python3

.PHONY: lint test frontend native build check
lint:
	$(PYTHON) -m ruff check mcp_desktop_client tests
	cargo fmt --all -- --check
	cargo clippy -p desktop-manager --all-targets -- -D warnings

test:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) -m unittest discover -s tests -p 'test_*.py'
	cargo test -p desktop-manager --locked

frontend:
	npm run typecheck
	npm test
	npm run build

native:
	cargo check -p coding-tools-mcp-desktop-native --locked

build:
	$(PYTHON) -m build

check: lint test frontend native build
