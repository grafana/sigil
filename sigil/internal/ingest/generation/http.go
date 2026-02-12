package generation

import (
	"io"
	"net/http"

	sigilv1 "github.com/grafana/sigil/sigil/internal/gen/sigil/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

func NewHTTPHandler(exporter Exporter) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(req.Body)
		if err != nil {
			http.Error(w, "read body", http.StatusBadRequest)
			return
		}

		var request sigilv1.ExportGenerationsRequest
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(body, &request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		response := exporter.Export(req.Context(), &request)
		payload, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(response)
		if err != nil {
			http.Error(w, "marshal response", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write(payload)
	}
}
