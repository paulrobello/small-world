PORT := 2001
DEV_PID_FILE := .vite-dev.pid
DEV_LOG_FILE := .vite-dev.log

.PHONY: dev dev-start dev-stop dev-restart build preview lint checkall clean

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
			echo "port $(PORT) is already in use (pid $$pid)"; \
		else \
			rm -f $(DEV_PID_FILE); \
			nohup npx vite --host 0.0.0.0 --port $(PORT) > $(DEV_LOG_FILE) 2>&1 & echo $$! > $(DEV_PID_FILE); \
			sleep 0.8; \
			echo "Vite dev server started (pid `cat $(DEV_PID_FILE)`) at http://localhost:$(PORT)"; \
			sed -n 's/^/    /p' $(DEV_LOG_FILE); \
		fi; \
	fi

dev-stop:
	@if [ -f $(DEV_PID_FILE) ] && kill -0 `cat $(DEV_PID_FILE)` 2>/dev/null; then \
		kill `cat $(DEV_PID_FILE)` && echo "Vite dev server stopped (pid `cat $(DEV_PID_FILE)`)"; \
		rm -f $(DEV_PID_FILE); \
	else \
		pid=`lsof -ti:$(PORT) 2>/dev/null`; \
		if [ -n "$$pid" ]; then \
			kill $$pid && echo "stopped process on :$(PORT) (pid $$pid)"; \
		else \
			echo "Vite dev server is not running"; \
		fi; \
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

# Run all tests and local verification
checkall:
	@for test in tests/*.test.mjs; do \
		echo "node $$test"; \
		node "$$test"; \
	done
	python3 -m unittest discover -s tests -p 'test_*.py'
	$(MAKE) lint
	$(MAKE) build

# Remove build output
clean:
	rm -rf dist
