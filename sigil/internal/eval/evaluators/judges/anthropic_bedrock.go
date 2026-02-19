package judges

import (
	"context"
	"net/http"
	"strings"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	anthropicbedrock "github.com/anthropics/anthropic-sdk-go/bedrock"
	anthropicoption "github.com/anthropics/anthropic-sdk-go/option"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
)

const defaultBedrockRegion = "us-east-1"

// NewBedrockAnthropicClient constructs an Anthropic judge client backed by
// AWS Bedrock transport and signing.
func NewBedrockAnthropicClient(httpClient *http.Client, baseURL, region, bearerToken string) *AnthropicClient {
	trimmedRegion := strings.TrimSpace(region)
	if trimmedRegion == "" {
		trimmedRegion = defaultBedrockRegion
	}

	cfg := aws.Config{
		Region: trimmedRegion,
	}
	if trimmedBearerToken := strings.TrimSpace(bearerToken); trimmedBearerToken != "" {
		cfg.BearerAuthTokenProvider = anthropicbedrock.NewStaticBearerTokenProvider(trimmedBearerToken)
	} else {
		var err error
		cfg, err = awsconfig.LoadDefaultConfig(context.Background(), awsconfig.WithRegion(trimmedRegion))
		if err != nil {
			return &AnthropicClient{
				providerID: "bedrock",
				initErr:    err,
			}
		}
	}

	opts := make([]anthropicoption.RequestOption, 0, 3)
	opts = append(opts, anthropicbedrock.WithConfig(cfg))
	if httpClient != nil {
		opts = append(opts, anthropicoption.WithHTTPClient(httpClient))
	}
	if trimmedBaseURL := strings.TrimSpace(baseURL); trimmedBaseURL != "" {
		opts = append(opts, anthropicoption.WithBaseURL(trimmedBaseURL))
	}

	client := anthropic.NewClient(opts...)
	return &AnthropicClient{
		providerID:        "bedrock",
		messages:          client.Messages,
		models:            client.Models,
		supportsModelList: false,
	}
}
