package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

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

	damlYAML := `sdk-version: 3.4.11
name: playground-project
source: daml
version: 0.0.1
dependencies:
  - daml-prim
  - daml-stdlib
  - daml-script
`
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

	darPath := filepath.Join(tmpDir, ".daml", "dist", "playground-project-0.0.1.dar")
	darBytes, err := os.ReadFile(darPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, CompileResponse{Errors: []string{"failed to read DAR: " + err.Error()}})
		return
	}

	sandboxURL := os.Getenv("SANDBOX_URL")
	if sandboxURL == "" {
		sandboxURL = "http://localhost:7575"
	}

	uploadResp, err := http.Post(sandboxURL+"/v2/packages", "application/octet-stream", bytes.NewReader(darBytes))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, CompileResponse{Errors: []string{"failed to upload DAR: " + err.Error()}})
		return
	}
	defer uploadResp.Body.Close()
	io.Copy(io.Discard, uploadResp.Body)

	if uploadResp.StatusCode < 200 || uploadResp.StatusCode >= 300 {
		writeJSON(w, http.StatusBadGateway, CompileResponse{Errors: []string{fmt.Sprintf("sandbox returned %d", uploadResp.StatusCode)}})
		return
	}

	writeJSON(w, http.StatusOK, CompileResponse{Success: true})
}

func main() {
	port := os.Getenv("COMPILE_PORT")
	if port == "" {
		port = "8081"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("POST /compile", handleCompile)

	log.Printf("compile-service listening on :%s", port)
	if err := http.ListenAndServe(fmt.Sprintf(":%s", port), mux); err != nil {
		log.Fatal(err)
	}
}
