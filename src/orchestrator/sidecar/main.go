// HTTP Sidecar Server — runs inside the staging container (Container A).
//
// Accepts POST /exec { cmd, args, env, timeout } and executes the command
// inside the container, returning { stdout, stderr, exitCode } as JSON.
// timeout is in milliseconds (optional; default 60000, clamped to 1000–600000).
//
// Also exposes GET /health → { "status": "ok" }.
//
// This binary is statically linked and has no external dependencies, so it
// runs in any Linux container regardless of the installed language runtime
// (Node.js, Python, Go, Rust, etc.).
//
// Environment variables:
//   PORT          — TCP port to listen on (default: 8080)
//   SIDECAR_PATH  — HTTP path for the exec endpoint (default: /exec)
//   WORKSPACE     — working directory for spawned commands (default: /workspace)
//
// Usage:
//
//	PORT=8080 SIDECAR_PATH=/exec WORKSPACE=/workspace ./sidecar
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"time"
)

// execRequest mirrors the TypeScript ExecRequest interface.
type execRequest struct {
	Cmd     string            `json:"cmd"`
	Args    []string          `json:"args"`
	Env     map[string]string `json:"env"`
	Timeout *int              `json:"timeout"` // milliseconds; nil → 60000
}

// execResponse mirrors the TypeScript ExecResponse interface.
type execResponse struct {
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exitCode"`
}

func main() {
	port := envOr("PORT", "8080")
	sidecarPath := envOr("SIDECAR_PATH", "/exec")
	workspace := envOr("WORKSPACE", "/workspace")

	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[sidecar] GET /health from %s → 200", remoteAddr(r))
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("POST "+sidecarPath, func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[sidecar] POST %s from %s", sidecarPath, remoteAddr(r))

		var req execRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Printf("[sidecar] Bad JSON body: %v", err)
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON body"})
			return
		}

		if req.Cmd == "" {
			log.Printf("[sidecar] Missing cmd in request")
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cmd is required"})
			return
		}

		timeoutMs := 60_000
		if req.Timeout != nil {
			timeoutMs = clamp(*req.Timeout, 1_000, 600_000)
		}

		log.Printf("[sidecar] exec: %s %v (timeout: %dms)", req.Cmd, req.Args, timeoutMs)

		ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutMs)*time.Millisecond)
		defer cancel()

		cmd := exec.CommandContext(ctx, req.Cmd, req.Args...)
		cmd.Dir = workspace

		// Inherit the process environment, then layer caller-supplied overrides.
		cmd.Env = os.Environ()
		for k, v := range req.Env {
			cmd.Env = append(cmd.Env, k+"="+v)
		}

		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr

		exitCode := 0
		stderrExtra := ""

		if err := cmd.Run(); err != nil {
			if ctx.Err() == context.DeadlineExceeded {
				stderrExtra = fmt.Sprintf("\nSpawn error: command timed out after %dms", timeoutMs)
			} else if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else {
				stderrExtra = fmt.Sprintf("\nSpawn error: %v", err)
				exitCode = 1
			}
		}

		log.Printf("[sidecar] exec done: exit %d", exitCode)
		writeJSON(w, http.StatusOK, execResponse{
			Stdout:   stdout.String(),
			Stderr:   stderr.String() + stderrExtra,
			ExitCode: exitCode,
		})
	})

	// Catch-all: 404 with a helpful message.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[sidecar] %s %s from %s → 404 (expected POST %s)", r.Method, r.URL.Path, remoteAddr(r), sidecarPath)
		writeJSON(w, http.StatusNotFound, map[string]string{"error": fmt.Sprintf("Use POST %s", sidecarPath)})
	})

	addr := net.JoinHostPort("0.0.0.0", port)
	log.Printf("[sidecar] Listening on %s%s (workspace: %s)", addr, sidecarPath, workspace)
	log.Printf("[sidecar] Health check: GET http://localhost:%s/health", port)

	srv := &http.Server{Addr: addr, Handler: mux}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("[sidecar] Server error: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func remoteAddr(r *http.Request) string {
	if addr := r.RemoteAddr; addr != "" {
		return addr
	}
	return "unknown"
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
