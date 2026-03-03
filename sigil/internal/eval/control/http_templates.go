package control

import (
	"net/http"
	"strings"

	evalpkg "github.com/grafana/sigil/sigil/internal/eval"
)

const templatePathPrefix = "/api/v1/eval/templates/"

// handleTemplates handles POST (create) and GET (list) on /api/v1/eval/templates.
func (s *TemplateService) handleTemplates(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	switch req.Method {
	case http.MethodPost:
		var createReq CreateTemplateRequest
		if err := decodeJSONBody(req, &createReq); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		tmpl, err := s.CreateTemplate(req.Context(), tenantID, createReq)
		if err != nil {
			writeControlWriteError(w, err)
			return
		}

		// Fetch versions for the response.
		versions, err := s.ListTemplateVersions(req.Context(), tenantID, tmpl.TemplateID)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusOK, templateCreateResponse(tmpl, versions))
	case http.MethodGet:
		limit, cursor, err := parsePagination(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		scope := parseTemplateScope(req)
		items, nextCursor, err := s.ListTemplates(req.Context(), tenantID, scope, limit, cursor)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items":       items,
			"next_cursor": formatCursor(nextCursor),
		})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// routeTemplateSubpaths routes /api/v1/eval/templates/{...} to the right handler.
// It handles: /{id}, /{id}:fork, /{id}/versions, /{id}/versions/{v}.
func (s *TemplateService) routeTemplateSubpaths(w http.ResponseWriter, req *http.Request) {
	tenantID, ok := tenantIDFromRequest(w, req)
	if !ok {
		return
	}

	subpath := strings.TrimPrefix(req.URL.Path, templatePathPrefix)
	if subpath == "" {
		http.Error(w, "invalid template path", http.StatusBadRequest)
		return
	}

	// Check for /{id}:fork action.
	if id, action, valid := pathIDAction(req.URL.Path, templatePathPrefix); valid && action == "fork" {
		s.handleTemplateFork(w, req, tenantID, id)
		return
	}

	// Check for /{id}/versions or /{id}/versions/{v}.
	parts := strings.SplitN(subpath, "/", 3)
	switch len(parts) {
	case 1:
		// /{id} — get or delete by ID.
		templateID := parts[0]
		if templateID == "" {
			http.Error(w, "invalid template id", http.StatusBadRequest)
			return
		}
		s.handleTemplateByID(w, req, tenantID, templateID)
	case 2:
		// /{id}/versions — list or publish versions.
		templateID := parts[0]
		if templateID == "" || parts[1] != "versions" {
			http.Error(w, "invalid template path", http.StatusBadRequest)
			return
		}
		s.handleTemplateVersions(w, req, tenantID, templateID)
	case 3:
		// /{id}/versions/{v} — get specific version.
		templateID := parts[0]
		if templateID == "" || parts[1] != "versions" || parts[2] == "" {
			http.Error(w, "invalid template path", http.StatusBadRequest)
			return
		}
		s.handleTemplateVersionByID(w, req, tenantID, templateID, parts[2])
	default:
		http.Error(w, "invalid template path", http.StatusBadRequest)
	}
}

func (s *TemplateService) handleTemplateByID(w http.ResponseWriter, req *http.Request, tenantID, templateID string) {
	switch req.Method {
	case http.MethodGet:
		tmpl, ver, err := s.GetTemplate(req.Context(), tenantID, templateID)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		if tmpl == nil {
			http.NotFound(w, req)
			return
		}

		versions, err := s.ListTemplateVersions(req.Context(), tenantID, templateID)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}

		writeJSON(w, http.StatusOK, templateGetResponse(tmpl, ver, versions))
	case http.MethodDelete:
		if err := s.DeleteTemplate(req.Context(), tenantID, templateID); err != nil {
			writeControlWriteError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *TemplateService) handleTemplateFork(w http.ResponseWriter, req *http.Request, tenantID, templateID string) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var forkReq ForkTemplateRequest
	if err := decodeJSONBody(req, &forkReq); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	created, err := s.ForkTemplate(req.Context(), tenantID, templateID, forkReq)
	if err != nil {
		writeControlWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, created)
}

func (s *TemplateService) handleTemplateVersions(w http.ResponseWriter, req *http.Request, tenantID, templateID string) {
	switch req.Method {
	case http.MethodPost:
		var pubReq PublishVersionRequest
		if err := decodeJSONBody(req, &pubReq); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		ver, err := s.PublishVersion(req.Context(), tenantID, templateID, pubReq)
		if err != nil {
			writeControlWriteError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, ver)
	case http.MethodGet:
		versions, err := s.ListTemplateVersions(req.Context(), tenantID, templateID)
		if err != nil {
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items": versions,
		})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *TemplateService) handleTemplateVersionByID(w http.ResponseWriter, req *http.Request, tenantID, templateID, version string) {
	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ver, err := s.GetTemplateVersion(req.Context(), tenantID, templateID, version)
	if err != nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	if ver == nil {
		http.NotFound(w, req)
		return
	}
	writeJSON(w, http.StatusOK, ver)
}

func parseTemplateScope(req *http.Request) *evalpkg.TemplateScope {
	raw := strings.TrimSpace(req.URL.Query().Get("scope"))
	if raw == "" {
		return nil
	}
	scope := evalpkg.TemplateScope(raw)
	return &scope
}

// templateCreateResponse builds the response for template creation.
// It includes the template definition fields plus the versions array.
func templateCreateResponse(tmpl *evalpkg.TemplateDefinition, versions []evalpkg.TemplateVersion) map[string]any {
	versionSummaries := make([]map[string]any, 0, len(versions))
	for _, v := range versions {
		versionSummaries = append(versionSummaries, map[string]any{
			"version":    v.Version,
			"changelog":  v.Changelog,
			"created_at": v.CreatedAt,
		})
	}
	return map[string]any{
		"tenant_id":      tmpl.TenantID,
		"template_id":    tmpl.TemplateID,
		"scope":          tmpl.Scope,
		"kind":           tmpl.Kind,
		"description":    tmpl.Description,
		"latest_version": tmpl.LatestVersion,
		"versions":       versionSummaries,
		"created_at":     tmpl.CreatedAt,
		"updated_at":     tmpl.UpdatedAt,
	}
}

// templateGetResponse builds the response for GET template by ID.
// It includes the template definition, config/output_keys from the latest version, and the versions array.
func templateGetResponse(tmpl *evalpkg.TemplateDefinition, latestVer *evalpkg.TemplateVersion, versions []evalpkg.TemplateVersion) map[string]any {
	resp := map[string]any{
		"tenant_id":      tmpl.TenantID,
		"template_id":    tmpl.TemplateID,
		"scope":          tmpl.Scope,
		"kind":           tmpl.Kind,
		"description":    tmpl.Description,
		"latest_version": tmpl.LatestVersion,
		"created_at":     tmpl.CreatedAt,
		"updated_at":     tmpl.UpdatedAt,
	}

	if latestVer != nil {
		resp["config"] = latestVer.Config
		resp["output_keys"] = latestVer.OutputKeys
	}

	versionSummaries := make([]map[string]any, 0, len(versions))
	for _, v := range versions {
		versionSummaries = append(versionSummaries, map[string]any{
			"version":    v.Version,
			"changelog":  v.Changelog,
			"created_at": v.CreatedAt,
		})
	}
	resp["versions"] = versionSummaries

	return resp
}
