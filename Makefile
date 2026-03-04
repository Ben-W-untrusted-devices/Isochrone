VENV_DIR := .venv
VENV_BIN := $(VENV_DIR)/bin
PYTHON ?= $(VENV_BIN)/python
PIP ?= $(PYTHON) -m pip
RUFF ?= $(VENV_BIN)/ruff
MYPY ?= $(VENV_BIN)/mypy
PYTEST ?= $(VENV_BIN)/pytest
WEB_DIR := web
PRE_COMMIT_HOME ?= .cache/pre-commit

.PHONY: bootstrap bootstrap-python bootstrap-web precommit-install format lint test check build clean

bootstrap: bootstrap-python bootstrap-web

bootstrap-python:
	python3 -m venv $(VENV_DIR)
	$(PIP) install -e ".[dev]"

precommit-install:
	PRE_COMMIT_HOME=$(PRE_COMMIT_HOME) $(VENV_BIN)/pre-commit install

bootstrap-web:
	npm --prefix $(WEB_DIR) install

format:
	$(RUFF) format data_pipeline
	npm --prefix $(WEB_DIR) run format

lint:
	$(RUFF) check data_pipeline
	$(RUFF) format --check data_pipeline
	$(MYPY) data_pipeline/src
	npm --prefix $(WEB_DIR) run lint
	npm --prefix $(WEB_DIR) run format:check

test:
	$(PYTEST) -q
	npm --prefix $(WEB_DIR) run test

check: lint test

build:
	npm --prefix $(WEB_DIR) run build

clean:
	rm -rf .pytest_cache .mypy_cache .ruff_cache data_pipeline/.pytest_cache web/dist
