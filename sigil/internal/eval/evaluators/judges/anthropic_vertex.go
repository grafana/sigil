package judges

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	anthropicoption "github.com/anthropics/anthropic-sdk-go/option"
	anthropicvertex "github.com/anthropics/anthropic-sdk-go/vertex"
	"golang.org/x/oauth2/google"
)

const defaultVertexLocation = "global"
const vertexCloudPlatformScope = "https://www.googleapis.com/auth/cloud-platform"

// NewAnthropicVertexClient constructs an Anthropic judge client backed by
// Anthropic-on-Vertex using ADC or explicit Google credentials.
func NewAnthropicVertexClient(httpClient *http.Client, baseURL, projectID, location, credentialsFile, credentialsJSON string) *AnthropicClient {
	credentials, err := resolveGoogleCredentials(strings.TrimSpace(credentialsFile), strings.TrimSpace(credentialsJSON))
	if err != nil {
		return &AnthropicClient{
			providerID: "anthropic-vertex",
			initErr:    err,
		}
	}
	return newAnthropicVertexClientWithCredentials(httpClient, baseURL, projectID, location, credentials)
}

func newAnthropicVertexClientWithCredentials(httpClient *http.Client, baseURL, projectID, location string, credentials *google.Credentials) *AnthropicClient {
	trimmedProjectID := strings.TrimSpace(projectID)
	if trimmedProjectID == "" {
		return &AnthropicClient{
			providerID: "anthropic-vertex",
			initErr:    fmt.Errorf("project id is required"),
		}
	}
	trimmedLocation := strings.TrimSpace(location)
	if trimmedLocation == "" {
		trimmedLocation = defaultVertexLocation
	}

	opts := make([]anthropicoption.RequestOption, 0, 3)
	if httpClient != nil {
		// Keep custom transport support for tests; vertex auth middleware can still
		// replace this with the token-aware client in the next option.
		opts = append(opts, anthropicoption.WithHTTPClient(httpClient))
	}
	opts = append(opts, anthropicvertex.WithCredentials(context.Background(), trimmedLocation, trimmedProjectID, credentials))
	if trimmedBaseURL := strings.TrimSpace(baseURL); trimmedBaseURL != "" {
		opts = append(opts, anthropicoption.WithBaseURL(trimmedBaseURL))
	}

	client := anthropic.NewClient(opts...)
	return &AnthropicClient{
		providerID:        "anthropic-vertex",
		messages:          client.Messages,
		models:            client.Models,
		supportsModelList: false,
	}
}

func resolveGoogleCredentials(credentialsFile, credentialsJSON string) (*google.Credentials, error) {
	if credentialsFile != "" && credentialsJSON != "" {
		return nil, fmt.Errorf("credentials file and credentials json are mutually exclusive")
	}

	ctx := context.Background()
	if credentialsJSON != "" {
		payload := []byte(credentialsJSON)
		credentialType, err := oauthCredentialsTypeFromJSON(payload)
		if err != nil {
			return nil, fmt.Errorf("google credentials json is invalid: %w", err)
		}
		return google.CredentialsFromJSONWithType(ctx, payload, credentialType, vertexCloudPlatformScope)
	}
	if credentialsFile != "" {
		payload, err := os.ReadFile(credentialsFile)
		if err != nil {
			return nil, err
		}
		credentialType, err := oauthCredentialsTypeFromJSON(payload)
		if err != nil {
			return nil, fmt.Errorf("google credentials file is invalid: %w", err)
		}
		return google.CredentialsFromJSONWithType(ctx, payload, credentialType, vertexCloudPlatformScope)
	}

	return google.FindDefaultCredentials(ctx, vertexCloudPlatformScope)
}
