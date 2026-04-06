package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthEndpoint(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if w.Body.String() != `{"status":"ok"}` {
		t.Errorf("unexpected body: %s", w.Body.String())
	}
}

func TestCompileEndpoint_MissingBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/compile", nil)
	w := httptest.NewRecorder()
	handleCompile(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestCompileEndpoint_InvalidJSON(t *testing.T) {
	body := strings.NewReader(`not json`)
	req := httptest.NewRequest(http.MethodPost, "/compile", body)
	w := httptest.NewRecorder()
	handleCompile(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestCompileEndpoint_EmptySource(t *testing.T) {
	body := strings.NewReader(`{"files":{}}`)
	req := httptest.NewRequest(http.MethodPost, "/compile", body)
	w := httptest.NewRecorder()
	handleCompile(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}
