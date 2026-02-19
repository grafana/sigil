package modelcards

var resolveProviderAliasMap = map[string][]string{
	"gemini":         {"google"},
	"google-vertex":  {"vertex"},
	"google_vertex":  {"vertex"},
	"vertex-ai":      {"vertex"},
	"vertexai":       {"vertex"},
	"aws-bedrock":    {"bedrock"},
	"amazon-bedrock": {"bedrock"},
	"amazon_bedrock": {"bedrock"},
	"azure-openai":   {"openai"},
	"azure_openai":   {"openai"},
	"azureopenai":    {"openai"},
	"azure":          {"openai"},
	"xai":            {"x-ai"},
	"meta":           {"meta-llama"},
	"mistral":        {"mistralai"},
	"cohere-ai":      {"cohere"},
}

type resolveMappedAliasRule struct {
	Provider            string
	Alias               string
	TargetSourceModelID string
}

var resolveMappedAliasRules = []resolveMappedAliasRule{
	{
		Provider:            "anthropic",
		Alias:               "claude-opus-4-6-v1",
		TargetSourceModelID: "anthropic/claude-opus-4.6",
	},
	{
		Provider:            "bedrock",
		Alias:               "cohere.command-r-v1:0",
		TargetSourceModelID: "cohere/command-r-08-2024",
	},
	{
		Provider:            "bedrock",
		Alias:               "cohere.command-r-plus-v1:0",
		TargetSourceModelID: "cohere/command-r-plus-08-2024",
	},
	{
		Provider:            "bedrock",
		Alias:               "mistral.ministral-3-8b-instruct",
		TargetSourceModelID: "mistralai/ministral-8b-2512",
	},
	{
		Provider:            "anthropic",
		Alias:               "claude-opus-4-0",
		TargetSourceModelID: "anthropic/claude-opus-4",
	},
	{
		Provider:            "anthropic",
		Alias:               "claude-sonnet-4-0",
		TargetSourceModelID: "anthropic/claude-sonnet-4",
	},
	{
		Provider:            "vertex",
		Alias:               "claude-opus-4-0",
		TargetSourceModelID: "anthropic/claude-opus-4",
	},
	{
		Provider:            "vertex",
		Alias:               "claude-sonnet-4-0",
		TargetSourceModelID: "anthropic/claude-sonnet-4",
	},
	{
		Provider:            "openai",
		Alias:               "gpt-3.5-turbo-0125",
		TargetSourceModelID: "openai/gpt-3.5-turbo",
	},
	{
		Provider:            "openai",
		Alias:               "gpt-3.5-turbo-0301",
		TargetSourceModelID: "openai/gpt-3.5-turbo",
	},
	{
		Provider:            "openai",
		Alias:               "gpt-3.5-turbo-1106",
		TargetSourceModelID: "openai/gpt-3.5-turbo",
	},
	{
		Provider:            "openai",
		Alias:               "gpt-3.5-turbo-16k-0613",
		TargetSourceModelID: "openai/gpt-3.5-turbo-16k",
	},
	{
		Provider:            "openai",
		Alias:               "gpt-4-0125-preview",
		TargetSourceModelID: "openai/gpt-4-turbo-preview",
	},
	{
		Provider:            "openai",
		Alias:               "gpt-4-0613",
		TargetSourceModelID: "openai/gpt-4",
	},
	{
		Provider:            "openai",
		Alias:               "gpt-4-turbo-2024-04-09",
		TargetSourceModelID: "openai/gpt-4-turbo",
	},
	{
		Provider:            "openai",
		Alias:               "gpt-4o-audio-preview-2024-10-01",
		TargetSourceModelID: "openai/gpt-4o-audio-preview",
	},
	{
		Provider:            "openai",
		Alias:               "gpt-4o-audio-preview-2024-12-17",
		TargetSourceModelID: "openai/gpt-4o-audio-preview",
	},
	{
		Provider:            "openai",
		Alias:               "gpt-4o-audio-preview-2025-06-03",
		TargetSourceModelID: "openai/gpt-4o-audio-preview",
	},
	{
		Provider:            "openai",
		Alias:               "gpt-5.1-2025-11-13",
		TargetSourceModelID: "openai/gpt-5.1",
	},
	{
		Provider:            "openai",
		Alias:               "gpt-5.2-2025-12-11",
		TargetSourceModelID: "openai/gpt-5.2",
	},
	{
		Provider:            "openai",
		Alias:               "gpt-5.2-pro-2025-12-11",
		TargetSourceModelID: "openai/gpt-5.2-pro",
	},
	{
		Provider:            "openai",
		Alias:               "o1-pro-2025-03-19",
		TargetSourceModelID: "openai/o1-pro",
	},
}
