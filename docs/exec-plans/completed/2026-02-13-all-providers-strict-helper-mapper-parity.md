---
owner: sigil-core
status: completed
last_reviewed: 2026-02-14
source_of_truth: true
audience: both
---

# Execution Plan: All Providers Strict Helper + Mapper Parity (All SDKs)

## Implementation Status (2026-02-14)

Completed. Strict wrapper + strict mapper parity landed for OpenAI, Anthropic, and Gemini across JS, Python, Go, Java, and .NET. Legacy bridge/request-wrapper DTO surfaces were removed from public helper APIs. A final provider-field verification pass aligned Anthropic/Gemini metadata extensions (`server_tool_use`, Gemini thinking/tool-use-prompt fields) across all SDKs.

## Goal

Reach one consistent contract across `OpenAI`, `Anthropic`, and `Gemini` in `JS`, `Python`, `Go`, `Java`, and `.NET`:

- strict provider wrapper helpers (provider-mirror APIs, official provider SDK types)
- strict mapper helpers (map official provider request/response payloads for manual instrumentation)

## End State Contract

Every provider/language surface must support two first-class usage modes:

1. **Wrapper mode**: call provider + record in one API
2. **Manual mode**: user controls recorder lifecycle and calls `fromRequestResponse` / `fromStream` with strict provider request/response types

No simplified provider DTO layer is exposed publicly.

## Where We Are (2026-02-13)

| Language | OpenAI | Anthropic | Gemini | Status |
|---|---|---|---|---|
| JS | strict | simplified DTO | simplified DTO | gap |
| Python | strict | simplified DTO | simplified DTO | gap |
| Go | strict | strict | request wrapper around strict SDK args | gap |
| Java | strict + legacy helper still present | uses OpenAI-shaped bridge DTOs | uses OpenAI-shaped bridge DTOs | gap |
| .NET | strict | strict | request wrapper around strict SDK args | gap |

## Gap Details With Current vs Target Snippets

### 1) JS Anthropic uses simplified DTO instead of strict provider types

Files:
- `sdks/js/src/providers/anthropic.ts`
- `sdks/js/test/providers.test.mjs`
- `sdks/js/docs/providers/anthropic.md`

Current:

```ts
export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
}

export async function completion(
  client: SigilClient,
  request: AnthropicRequest,
  providerCall: (request: AnthropicRequest) => Promise<AnthropicResponse>,
  options: AnthropicOptions = {}
): Promise<AnthropicResponse> { ... }
```

Target:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import type { Message, MessageCreateParams } from "@anthropic-ai/sdk/resources/messages";

export const messages = {
  create: anthropicMessagesCreate,
  stream: anthropicMessagesStream,
  fromRequestResponse: anthropicMessagesFromRequestResponse,
  fromStream: anthropicMessagesFromStream,
};

function anthropicMessagesFromRequestResponse(
  request: MessageCreateParams,
  response: Message,
  options?: AnthropicOptions
): GenerationResult { ... }
```

### 2) JS Gemini uses simplified DTO instead of strict provider types

Files:
- `sdks/js/src/providers/gemini.ts`
- `sdks/js/test/providers.test.mjs`
- `sdks/js/docs/providers/gemini.md`

Current:

```ts
export interface GeminiRequest {
  model: string;
  messages: GeminiMessage[];
  functionCallingMode?: unknown;
}
```

Target (representative API sketch; exact type names pinned to selected SDK version):

```ts
import type { Content, GenerateContentConfig, GenerateContentResponse } from "@google/genai";

export const models = {
  generateContent: geminiGenerateContent,
  generateContentStream: geminiGenerateContentStream,
  fromRequestResponse: geminiFromRequestResponse,
  fromStream: geminiFromStream,
};

function geminiFromRequestResponse(
  model: string,
  contents: Content[],
  config: GenerateContentConfig | undefined,
  response: GenerateContentResponse,
  options?: GeminiOptions
): GenerationResult { ... }
```

### 3) Python Anthropic uses simplified dataclasses instead of strict provider types

Files:
- `sdks/python-providers/anthropic/sigil_sdk_anthropic/provider.py`
- `sdks/python-providers/anthropic/sigil_sdk_anthropic/__init__.py`
- `sdks/python-providers/anthropic/tests/test_anthropic_provider.py`
- `sdks/python-providers/anthropic/README.md`

Current:

```python
@dataclass(slots=True)
class AnthropicRequest:
    model: str
    messages: list[AnthropicMessage]

def from_request_response(
    request: AnthropicRequest,
    response: AnthropicResponse,
    options: AnthropicOptions | None = None,
) -> Generation:
    ...
```

Target:

```python
from anthropic.types.message_create_params import MessageCreateParams
from anthropic.types.message import Message as AnthropicMessage

class _MessagesNamespace:
    create = staticmethod(_messages_create)
    create_async = staticmethod(_messages_create_async)
    stream = staticmethod(_messages_stream)
    stream_async = staticmethod(_messages_stream_async)
    from_request_response = staticmethod(_messages_from_request_response)
    from_stream = staticmethod(_messages_from_stream)

def _messages_from_request_response(
    request: MessageCreateParams,
    response: AnthropicMessage,
    options: AnthropicOptions | None = None,
) -> Generation:
    ...
```

### 4) Python Gemini uses simplified dataclasses instead of strict provider types

Files:
- `sdks/python-providers/gemini/sigil_sdk_gemini/provider.py`
- `sdks/python-providers/gemini/sigil_sdk_gemini/__init__.py`
- `sdks/python-providers/gemini/tests/test_gemini_provider.py`
- `sdks/python-providers/gemini/README.md`

Current:

```python
@dataclass(slots=True)
class GeminiRequest:
    model: str
    messages: list[GeminiMessage]
    function_calling_mode: Any = None
```

Target:

```python
from google.genai import types as genai_types

def _models_generate_content(
    client,
    model: str,
    contents: list[genai_types.Content],
    config: genai_types.GenerateContentConfig | None,
    provider_call,
    options: GeminiOptions | None = None,
):
    ...

def _models_from_request_response(
    model: str,
    contents: list[genai_types.Content],
    config: genai_types.GenerateContentConfig | None,
    response: genai_types.GenerateContentResponse,
    options: GeminiOptions | None = None,
) -> Generation:
    ...
```

### 5) Go Gemini request wrapper must be removed for strict request parity

Files:
- `sdks/go-providers/gemini/mapper.go`
- `sdks/go-providers/gemini/record.go`
- `sdks/go-providers/gemini/stream_mapper.go`
- `sdks/go-providers/gemini/README.md`
- `sdks/go-providers/gemini/*_test.go`

Current:

```go
type GenerateContentRequest struct {
    Model    string
    Contents []*genai.Content
    Config   *genai.GenerateContentConfig
}

func FromRequestResponse(req GenerateContentRequest, resp *genai.GenerateContentResponse, opts ...Option) (sigil.Generation, error) { ... }
```

Target:

```go
func GenerateContent(
    ctx context.Context,
    client *sigil.Client,
    provider *genai.Client,
    model string,
    contents []*genai.Content,
    config *genai.GenerateContentConfig,
    opts ...Option,
) (*genai.GenerateContentResponse, error) { ... }

func FromRequestResponse(
    model string,
    contents []*genai.Content,
    config *genai.GenerateContentConfig,
    resp *genai.GenerateContentResponse,
    opts ...Option,
) (sigil.Generation, error) { ... }
```

### 6) Java OpenAI still exposes legacy bridge helper

Files:
- `sdks/java/providers/openai/src/main/java/com/grafana/sigil/sdk/providers/openai/ProviderAdapterSupport.java`
- references in `sdks/java/providers/anthropic/**`, `sdks/java/providers/gemini/**`, `sdks/java/devex-emitter/**`, `sdks/java/benchmarks/**`

Current:

```java
public final class ProviderAdapterSupport {
    public static GenerationResult fromRequestResponse(OpenAiChatRequest request, OpenAiChatResponse response, OpenAiOptions options) { ... }
}
```

Target:

```java
// Removed: ProviderAdapterSupport
// Kept strict OpenAI-only surfaces:
public final class OpenAiChatCompletions { ... }
public final class OpenAiResponses { ... }
```

### 7) Java Anthropic is built on OpenAI-shaped bridge DTOs, not strict Anthropic SDK types

Files:
- `sdks/java/providers/anthropic/src/main/java/com/grafana/sigil/sdk/providers/anthropic/AnthropicAdapter.java`
- `sdks/java/providers/anthropic/src/test/java/com/grafana/sigil/sdk/providers/anthropic/AnthropicAdapterTest.java`
- `sdks/java/providers/anthropic/README.md`
- `sdks/java/providers/anthropic/build.gradle.kts`

Current:

```java
public static ProviderAdapterSupport.OpenAiChatResponse completion(
    SigilClient client,
    ProviderAdapterSupport.OpenAiChatRequest request,
    ThrowingFunction<ProviderAdapterSupport.OpenAiChatRequest, ProviderAdapterSupport.OpenAiChatResponse> providerCall,
    ProviderAdapterSupport.OpenAiOptions options) throws Exception
```

Target (representative):

```java
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;

public final class AnthropicMessages {
    public static Message create(
        SigilClient client,
        MessageCreateParams request,
        ThrowingFunction<MessageCreateParams, Message> providerCall,
        AnthropicOptions options
    ) throws Exception { ... }

    public static GenerationResult fromRequestResponse(
        MessageCreateParams request,
        Message response,
        AnthropicOptions options
    ) { ... }
}
```

### 8) Java Gemini is built on OpenAI-shaped bridge DTOs, not strict Gemini SDK types

Files:
- `sdks/java/providers/gemini/src/main/java/com/grafana/sigil/sdk/providers/gemini/GeminiAdapter.java`
- `sdks/java/providers/gemini/src/test/java/com/grafana/sigil/sdk/providers/gemini/GeminiAdapterTest.java`
- `sdks/java/providers/gemini/README.md`
- `sdks/java/providers/gemini/build.gradle.kts`

Current:

```java
public static ProviderAdapterSupport.OpenAiChatResponse completion(
    SigilClient client,
    ProviderAdapterSupport.OpenAiChatRequest request,
    ThrowingFunction<ProviderAdapterSupport.OpenAiChatRequest, ProviderAdapterSupport.OpenAiChatResponse> providerCall,
    ProviderAdapterSupport.OpenAiOptions options) throws Exception
```

Target (representative):

```java
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;

public final class GeminiModels {
    public static GenerateContentResponse generateContent(
        SigilClient client,
        String model,
        List<Content> contents,
        GenerateContentConfig config,
        ThrowingFunction<GeminiGenerateContentRequest, GenerateContentResponse> providerCall,
        GeminiOptions options
    ) throws Exception { ... }

    public static GenerationResult fromRequestResponse(
        String model,
        List<Content> contents,
        GenerateContentConfig config,
        GenerateContentResponse response,
        GeminiOptions options
    ) { ... }
}
```

### 9) .NET Gemini request wrapper should be removed for strict request parity

Files:
- `sdks/dotnet/src/Grafana.Sigil.Gemini/GenerateContentRequest.cs`
- `sdks/dotnet/src/Grafana.Sigil.Gemini/GeminiRecorder.cs`
- `sdks/dotnet/src/Grafana.Sigil.Gemini/GeminiGenerationMapper.cs`
- `sdks/dotnet/tests/Grafana.Sigil.Gemini.Tests/GeminiMappingAndRecorderTests.cs`
- `sdks/dotnet/src/Grafana.Sigil.Gemini/README.md`

Current:

```csharp
public sealed record GenerateContentRequest
{
    public string Model { get; init; } = string.Empty;
    public List<Content> Contents { get; init; } = new();
    public GenerateContentConfig? Config { get; init; }
}
```

Target:

```csharp
public static Task<GenerateContentResponse> GenerateContentAsync(
    SigilClient client,
    Client provider,
    string model,
    IReadOnlyList<Content> contents,
    GenerateContentConfig? config = null,
    GeminiSigilOptions? options = null,
    CancellationToken cancellationToken = default);

public static Generation FromRequestResponse(
    string model,
    IReadOnlyList<Content> contents,
    GenerateContentConfig? config,
    GenerateContentResponse response,
    GeminiSigilOptions? options = null);
```

## Work Plan

1. **Java dependency inversion first**
   - Introduce strict Anthropic/Gemini Java helpers using official SDK models.
   - Remove `ProviderAdapterSupport` dependencies from Anthropic/Gemini modules.
   - Delete `ProviderAdapterSupport` after all references are migrated.

2. **JS strict provider migration**
   - Replace simplified DTOs in `anthropic.ts` and `gemini.ts` with strict provider types.
   - Move to provider-mirror namespaces for both providers.
   - Update tests and docs.

3. **Python strict provider migration**
   - Replace simplified dataclasses in Anthropic/Gemini providers with strict provider SDK types.
   - Keep wrapper + mapper pair availability and async parity.
   - Update tests and README docs.

4. **Go and .NET Gemini strict request parity**
   - Remove request wrapper structs/records and use strict SDK request shape parameters.
   - Update wrappers, mappers, tests, examples, and docs.

5. **Devex and docs parity sweep**
   - Ensure emitters and examples exercise wrapper and manual mapper flows for each provider.
   - Align all provider READMEs to the same “wrapper mode + manual mode” contract.

## Acceptance Criteria

1. Every provider/language exposes:
   - strict wrapper helpers
   - strict mapper helpers from provider request/response
2. No simplified public provider DTO surface remains.
3. Raw artifacts default remains OFF everywhere.
4. Manual instrumentation examples exist for each provider helper package.
5. Java `ProviderAdapterSupport` is removed and no provider depends on it.
6. All SDK provider tests and aggregate checks pass.

## Validation Commands

- `mise run test:ts:sdk-js`
- `mise run test:py:sdk-anthropic`
- `mise run test:py:sdk-openai`
- `mise run test:py:sdk-gemini`
- `mise run test:go:sdk-anthropic`
- `mise run test:go:sdk-openai`
- `mise run test:go:sdk-gemini`
- `mise run test:java:sdk-openai`
- `mise run test:java:sdk-anthropic`
- `mise run test:java:sdk-gemini`
- `mise run test:cs:sdk-openai`
- `mise run test:cs:sdk-anthropic`
- `mise run test:cs:sdk-gemini`
- `mise run test:sdk:all`
- `mise run lint`
- `mise run check`
