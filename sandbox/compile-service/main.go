package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

var buildCounter atomic.Int64

type CompileRequest struct {
	Files map[string]string `json:"files"`
}

type CompileResponse struct {
	Success bool     `json:"success"`
	Errors  []string `json:"errors,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

func handleCompile(w http.ResponseWriter, r *http.Request) {
	sandboxURL := os.Getenv("SANDBOX_URL")
	if sandboxURL == "" {
		sandboxURL = "http://localhost:7575"
	}

	if r.Body == nil {
		writeJSON(w, http.StatusBadRequest, CompileResponse{Errors: []string{"missing request body"}})
		return
	}

	var req CompileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, CompileResponse{Errors: []string{"invalid JSON: " + err.Error()}})
		return
	}

	if len(req.Files) == 0 {
		writeJSON(w, http.StatusBadRequest, CompileResponse{Errors: []string{"files must not be empty"}})
		return
	}

	tmpDir, err := os.MkdirTemp("", "daml-compile-*")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, CompileResponse{Errors: []string{"failed to create temp dir: " + err.Error()}})
		return
	}
	defer os.RemoveAll(tmpDir)

	version := fmt.Sprintf("0.0.%d", buildCounter.Add(1))
	darName := fmt.Sprintf("playground-project-%s.dar", version)
	damlYAML := fmt.Sprintf(`sdk-version: 3.4.11
name: playground-project
source: daml
version: %s
dependencies:
  - daml-prim
  - daml-stdlib
  - daml-script
`, version)
	if err := os.WriteFile(filepath.Join(tmpDir, "daml.yaml"), []byte(damlYAML), 0644); err != nil {
		writeJSON(w, http.StatusInternalServerError, CompileResponse{Errors: []string{"failed to write daml.yaml: " + err.Error()}})
		return
	}

	damlDir := filepath.Join(tmpDir, "daml")
	if err := os.MkdirAll(damlDir, 0755); err != nil {
		writeJSON(w, http.StatusInternalServerError, CompileResponse{Errors: []string{"failed to create daml dir: " + err.Error()}})
		return
	}

	for name, content := range req.Files {
		filePath := filepath.Join(damlDir, name)
		if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
			writeJSON(w, http.StatusInternalServerError, CompileResponse{Errors: []string{"failed to create file dir: " + err.Error()}})
			return
		}
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			writeJSON(w, http.StatusInternalServerError, CompileResponse{Errors: []string{"failed to write file " + name + ": " + err.Error()}})
			return
		}
	}

	cmd := exec.Command("dpm", "build")
	cmd.Dir = tmpDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		errLines := strings.Split(strings.TrimSpace(string(out)), "\n")
		writeJSON(w, http.StatusUnprocessableEntity, CompileResponse{Errors: errLines})
		return
	}

	darPath := filepath.Join(tmpDir, ".daml", "dist", darName)
	darBytes, err := os.ReadFile(darPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, CompileResponse{Errors: []string{"failed to read DAR: " + err.Error()}})
		return
	}

	// Retry DAR upload for transient Canton errors during startup.
	const maxRetries = 3
	var lastErr string
	for attempt := range maxRetries {
		uploadResp, err := http.Post(sandboxURL+"/v2/packages", "application/octet-stream", bytes.NewReader(darBytes))
		if err != nil {
			lastErr = "failed to upload DAR: " + err.Error()
			time.Sleep(time.Duration(attempt+1) * 2 * time.Second)
			continue
		}
		respBody, _ := io.ReadAll(uploadResp.Body)
		uploadResp.Body.Close()

		if uploadResp.StatusCode >= 200 && uploadResp.StatusCode < 300 {
			writeJSON(w, http.StatusOK, CompileResponse{Success: true})
			return
		}

		lastErr = fmt.Sprintf("sandbox returned %d: %s", uploadResp.StatusCode, string(respBody))

		// Only retry on 503 or Canton "not ready" errors
		if uploadResp.StatusCode == 503 || strings.Contains(string(respBody), "not ready") || strings.Contains(string(respBody), "CANNOT_AUTODETECT_SYNCHRONIZER") {
			time.Sleep(time.Duration(attempt+1) * 2 * time.Second)
			continue
		}

		// Non-transient error, fail immediately
		writeJSON(w, http.StatusBadGateway, CompileResponse{Errors: []string{lastErr}})
		return
	}

	writeJSON(w, http.StatusBadGateway, CompileResponse{Errors: []string{lastErr}})
}

func newCantonProxy() http.Handler {
	sandboxURL := os.Getenv("SANDBOX_URL")
	if sandboxURL == "" {
		sandboxURL = "http://localhost:7575"
	}
	target, err := url.Parse(sandboxURL)
	if err != nil {
		log.Fatalf("invalid SANDBOX_URL %q: %v", sandboxURL, err)
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	return proxy
}

func main() {
	port := os.Getenv("COMPILE_PORT")
	if port == "" {
		port = "8081"
	}

	cantonProxy := newCantonProxy()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("POST /compile", handleCompile)
	// Proxy all other requests to Canton JSON API
	mux.Handle("/", cantonProxy)

	log.Printf("compile-service listening on :%s", port)
	if err := http.ListenAndServe(fmt.Sprintf(":%s", port), mux); err != nil {
		log.Fatal(err)
	}
}
