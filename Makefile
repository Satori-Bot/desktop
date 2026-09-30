PYTHON ?= python3
PACKAGE := mcp_desktop_client
TS := $(PACKAGE)/locales/app_zh_CN.ts
QM := $(PACKAGE)/locales/app_zh_CN.qm
PYSIDE6_LUPDATE ?= pyside6-lupdate
PYSIDE6_LRELEASE ?= pyside6-lrelease

.PHONY: lint test i18n-check i18n-update i18n-release build check

lint:
	$(PYTHON) -m ruff check $(PACKAGE) tests scripts

test:
	PYTHONDONTWRITEBYTECODE=1 $(PYTHON) -m unittest discover -s tests -p 'test_*.py'

i18n-update:
	$(PYSIDE6_LUPDATE) -tr-function-alias 'translate+=tr' -extensions py $(PACKAGE) \
		-source-language en_US -target-language zh_CN -locations relative -ts $(TS)

i18n-release:
	$(PYSIDE6_LRELEASE) $(TS) -qm $(QM)

i18n-check:
	$(PYTHON) scripts/check_desktop_i18n.py

build:
	$(PYTHON) -m build

check: lint test i18n-check build
