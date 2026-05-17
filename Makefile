PORT := 1999
HOST := 0.0.0.0
PID_FILE := .server.pid
LOG_FILE := .server.log
PYTHON := python3

.PHONY: dev start stop restart status logs build preview lint clean

# Vite dev server with hot reload (port 1999)
dev:
	npx vite --port $(PORT) --open

# Legacy Python static server (no HMR, no build)
start:
	@if [ -f $(PID_FILE) ] && kill -0 `cat $(PID_FILE)` 2>/dev/null; then \
		echo "already running (pid `cat $(PID_FILE)`) on $(HOST):$(PORT)"; \
	else \
		rm -f $(PID_FILE); \
		nohup $(PYTHON) server.py > $(LOG_FILE) 2>&1 & echo $$! > $(PID_FILE); \
		sleep 0.6; \
		echo "started (pid `cat $(PID_FILE)`) listening on $(HOST):$(PORT)"; \
		sed -n 's/^/    /p' $(LOG_FILE); \
	fi

stop:
	@if [ -f $(PID_FILE) ] && kill -0 `cat $(PID_FILE)` 2>/dev/null; then \
		kill `cat $(PID_FILE)` && echo "stopped (pid `cat $(PID_FILE)`)"; \
		rm -f $(PID_FILE); \
	else \
		pid=`lsof -ti:$(PORT) 2>/dev/null`; \
		if [ -n "$$pid" ]; then \
			kill $$pid && echo "stopped stray process on :$(PORT) (pid $$pid)"; \
		else \
			echo "not running"; \
		fi; \
		rm -f $(PID_FILE); \
	fi

restart: stop start

status:
	@if [ -f $(PID_FILE) ] && kill -0 `cat $(PID_FILE)` 2>/dev/null; then \
		echo "running (pid `cat $(PID_FILE)`) at http://localhost:$(PORT)"; \
	else \
		echo "stopped"; \
	fi

logs:
	@tail -f $(LOG_FILE)

# Production build (minified, tree-shaken, content-hashed assets)
build:
	npx vite build

# Lint
lint:
	npx eslint main.js src/

# Preview the production build locally
preview:
	npx vite preview --port $(PORT) --open

# Remove build output
clean:
	rm -rf dist
