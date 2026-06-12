PORT := 2001
DEV_PID_FILE := .vite-dev.pid
DEV_LOG_FILE := .vite-dev.log

.PHONY: dev dev-start dev-stop dev-restart build preview lint test checkall clean

# Vite dev server with hot reload (foreground, port 2001)
dev:
	npx vite --port $(PORT) --open

# Vite dev server in the background (port 2001)
dev-start:
	@if [ -f $(DEV_PID_FILE) ] && kill -0 `cat $(DEV_PID_FILE)` 2>/dev/null; then \
		echo "Vite dev server already running (pid `cat $(DEV_PID_FILE)`) at http://localhost:$(PORT)"; \
	else \
		pid=`lsof -ti:$(PORT) 2>/dev/null`; \
		if [ -n "$$pid" ]; then \
			echo "port $(PORT) held by pid $$pid — killing"; \
			kill $$pid 2>/dev/null; \
			for i in 1 2 3 4 5 6 7 8 9 10; do \
				sleep 0.2; \
				if ! lsof -ti:$(PORT) >/dev/null 2>&1; then break; fi; \
			done; \
			if lsof -ti:$(PORT) >/dev/null 2>&1; then \
				echo "pid $$pid did not exit; sending SIGKILL"; \
				kill -9 `lsof -ti:$(PORT) 2>/dev/null` 2>/dev/null; \
				sleep 0.3; \
			fi; \
		fi; \
		rm -f $(DEV_PID_FILE); \
		nohup npx vite --host 0.0.0.0 --port $(PORT) > $(DEV_LOG_FILE) 2>&1 & echo $$! > $(DEV_PID_FILE); \
		sleep 0.8; \
		echo "Vite dev server started (pid `cat $(DEV_PID_FILE)`) at http://localhost:$(PORT)"; \
		sed -n 's/^/    /p' $(DEV_LOG_FILE); \
	fi

dev-stop:
	@pid=""; \
	if [ -f $(DEV_PID_FILE) ] && kill -0 `cat $(DEV_PID_FILE)` 2>/dev/null; then \
		pid=`cat $(DEV_PID_FILE)`; \
	fi; \
	port_pid=`lsof -ti:$(PORT) 2>/dev/null`; \
	if [ -z "$$pid" ] && [ -z "$$port_pid" ]; then \
		echo "Vite dev server is not running"; \
		rm -f $(DEV_PID_FILE); \
	else \
		kill_pids="$$pid $$port_pid"; \
		for p in $$kill_pids; do kill $$p 2>/dev/null; done; \
		for i in 1 2 3 4 5 6 7 8 9 10; do \
			sleep 0.2; \
			if ! lsof -ti:$(PORT) >/dev/null 2>&1; then break; fi; \
		done; \
		if lsof -ti:$(PORT) >/dev/null 2>&1; then \
			echo "port $(PORT) still held; sending SIGKILL"; \
			kill -9 `lsof -ti:$(PORT) 2>/dev/null` 2>/dev/null; \
			sleep 0.3; \
		fi; \
		echo "stopped processes on :$(PORT) ($$kill_pids)"; \
		rm -f $(DEV_PID_FILE); \
	fi

dev-restart: dev-stop dev-start

# Production build (minified, tree-shaken, content-hashed assets)
build:
	npx vite build

# Preview the production build locally
preview:
	npx vite preview --port $(PORT) --open

# Lint
lint:
	npx eslint main.js src/

# Run all tests. `|| exit 1` is load-bearing: without it the for-loop's exit
# status is the last test's only, and earlier failures silently pass make.
test:
	@for test in tests/*.test.mjs; do \
		echo "node $$test"; \
		node "$$test" || exit 1; \
	done
	python3 -m unittest discover -s tests -p 'test_*.py'

# Run all tests and local verification
checkall: test
	$(MAKE) lint
	$(MAKE) build

# Remove build output
clean:
	rm -rf dist
