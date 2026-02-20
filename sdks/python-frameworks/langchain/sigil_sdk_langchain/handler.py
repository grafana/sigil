"""LangChain callback handlers for Sigil generation recording."""

from __future__ import annotations

from sigil_sdk_frameworks import SigilAsyncCallbackMixin, SigilSyncCallbackMixin

try:
    from langchain_core.callbacks import AsyncCallbackHandler, BaseCallbackHandler
except ModuleNotFoundError:  # pragma: no cover - handled by package dependency in normal installs
    class BaseCallbackHandler:  # type: ignore[no-redef]
        """Fallback base class when langchain-core is unavailable."""

    class AsyncCallbackHandler:  # type: ignore[no-redef]
        """Fallback async base class when langchain-core is unavailable."""


class SigilLangChainHandler(SigilSyncCallbackMixin, BaseCallbackHandler):
    """Sync LangChain callback handler that records Sigil generations."""

    _framework_name = "langchain"
    _framework_instrumentation_name = "github.com/grafana/sigil/sdks/python-frameworks/langchain"


class SigilAsyncLangChainHandler(SigilAsyncCallbackMixin, AsyncCallbackHandler):
    """Async LangChain callback handler that records Sigil generations."""

    _framework_name = "langchain"
    _framework_instrumentation_name = "github.com/grafana/sigil/sdks/python-frameworks/langchain"
